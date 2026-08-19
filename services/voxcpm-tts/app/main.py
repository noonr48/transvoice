import asyncio
import dataclasses
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app import audio as audio_utils
from app.cache import get_cache, AudioCache
from app.model import (
    VoxCPMEngine,
    reference_content_digest,
    synthesis_cache_context,
)
from app.schemas import (
    CachePrimeRequest,
    HealthResponse,
    ReferenceAudioDownloadRequest,
    ReferenceAudioPrimeRequest,
    TTSRequest,
    TTSWavRequest,
    VoxCpmBridgeRequest,
)
from app.segmenter import segment_text
from app.settings import settings
from app.voice_profiles import get_profile, list_profile_ids

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
# Reference download URLs can contain stable clip identifiers. The service logs
# status and timing explicitly; suppress the dependency's full request URL.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("voxcpm.main")

engine = VoxCPMEngine(settings)
semaphore: asyncio.Semaphore | None = None
_synthesis_executor: ThreadPoolExecutor | None = None
_synthesis_future: asyncio.Future | None = None

_request_count: int = 0
_cache_hits: int = 0
_cache_misses: int = 0
_start_time: float = 0.0


def _synthesis_is_busy() -> bool:
    return _synthesis_future is not None and not _synthesis_future.done()


def _service_is_busy() -> bool:
    return bool(semaphore and semaphore.locked()) or _synthesis_is_busy()


def _get_synthesis_executor() -> ThreadPoolExecutor:
    global _synthesis_executor
    if _synthesis_executor is None:
        _synthesis_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="voxcpm-synthesis",
        )
    return _synthesis_executor


async def _run_synthesis_job(function, *args, timeout: float = 60.0):
    """Run one model job without losing admission control on cancellation.

    Cancelling an asyncio wrapper cannot stop an already-running Python/GPU
    worker. The dedicated single-worker executor prevents overlap, while the
    tracked future keeps the service busy until the real worker has finished.
    """
    global _synthesis_future
    prior = _synthesis_future
    if prior is not None and not prior.done():
        await asyncio.shield(prior)

    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(_get_synthesis_executor(), function, *args)
    _synthesis_future = future

    def clear_if_current(done_future):
        global _synthesis_future
        try:
            worker_error = done_future.exception()
        except asyncio.CancelledError:
            worker_error = None
        if worker_error is not None:
            # Consume late executor failures even when the awaiting HTTP task
            # timed out or was cancelled. Log only the exception category;
            # model errors may carry private paths or request content.
            logger.error(
                "synthesis worker failed error_type=%s",
                type(worker_error).__name__,
            )
        if _synthesis_future is done_future:
            _synthesis_future = None

    future.add_done_callback(clear_if_current)
    return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)


async def _drain_synthesis(timeout: float = 65.0) -> bool:
    """Wait for an admitted worker before model unload during shutdown."""
    future = _synthesis_future
    if future is None or future.done():
        return True
    try:
        await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        logger.error("synthesis worker did not drain before shutdown timeout")
        return False
    except Exception:
        # A failed generation is still a completed GPU worker and is safe to
        # unload after its exception has been observed here.
        return True


def _shutdown_synthesis_executor() -> None:
    global _synthesis_executor
    executor = _synthesis_executor
    _synthesis_executor = None
    if executor is not None:
        executor.shutdown(wait=True, cancel_futures=True)


def _reference_digest(profile) -> str:
    return reference_content_digest(profile.reference_audio_path)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global semaphore, _start_time
    semaphore = asyncio.Semaphore(settings.TTS_SEMAPHORE_CONCURRENCY)
    _start_time = time.monotonic()
    engine.load()
    if engine.loaded:
        logger.info(
            "VoxCPM TTS ready on %s:%d (profiles: %s)",
            settings.TTS_HOST,
            settings.TTS_PORT,
            ", ".join(list_profile_ids()),
        )
    else:
        logger.error("VoxCPM TTS started unavailable because the real model did not load")
    yield
    logger.info("shutting down VoxCPM TTS")
    if await _drain_synthesis():
        engine.unload()
        _shutdown_synthesis_executor()
    else:
        # Never mutate/unload the model while its GPU worker still owns it.
        # The service manager's bounded stop policy will terminate the process.
        logger.error("leaving model loaded because synthesis is still active")
    _cleanup_old_refs()


app = FastAPI(title="VoxCPM2 TTS", version="0.1.0", lifespan=lifespan)


def _resolve_profile(req: TTSRequest | TTSWavRequest):
    pid = req.voice_profile_id or settings.TTS_DEFAULT_VOICE_PROFILE
    profile = get_profile(pid)
    if profile is None:
        raise HTTPException(404, f"voice profile not found: {pid}")
    overrides: dict[str, Any] = {}
    if req.cfg_value is not None:
        overrides["cfg_value"] = req.cfg_value
    if req.inference_timesteps is not None:
        overrides["inference_timesteps"] = req.inference_timesteps
    if req.reference_audio_path is not None:
        overrides["reference_audio_path"] = req.reference_audio_path
    if overrides:
        profile = dataclasses.replace(profile, **overrides)
    return profile


@app.get("/health", response_model=HealthResponse)
async def health():
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    cache = get_cache()
    return HealthResponse(
        ok=True,
        engine="voxcpm2",
        model_loaded=engine.loaded,
        sample_rate=settings.TTS_SAMPLE_RATE,
        device=settings.VOXCPM_DEVICE,
        voice_profiles=list_profile_ids(),
        cache_size=cache.size,
        cache_dir=cache.cache_dir,
    )


async def _synthesize_segments(text: str, profile, use_cache: bool):
    global _cache_hits, _cache_misses
    segments = segment_text(
        text,
        max_chars=settings.TTS_MAX_SEGMENT_CHARS,
        min_chars=settings.TTS_MIN_SEGMENT_CHARS,
    )
    cache = get_cache()
    reference_digest = _reference_digest(profile)
    for seg in segments:
        if use_cache:
            cache_key = AudioCache.make_key(
                settings.VOXCPM_MODEL_ID,
                profile.id,
                profile.cfg_value,
                profile.inference_timesteps,
                profile.normalize,
                seg,
                reference_digest,
                synthesis_cache_context(profile),
            )
            cached = cache.get(cache_key)
            if cached is not None:
                _cache_hits += 1
                yield cached
                continue
            _cache_misses += 1

        wav = await _run_synthesis_job(engine.generate, seg, profile)
        pcm16 = audio_utils.float32_to_int16(wav)

        if use_cache:
            cache.put(cache_key, pcm16)

        yield pcm16


@app.post("/v1/tts/stream")
async def tts_stream(req: TTSRequest, request: Request):
    global _request_count
    _request_count += 1
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    if semaphore is None:
        raise HTTPException(503, "service initializing")
    if _service_is_busy():
        raise HTTPException(429, "TTS engine busy, try again later")

    profile = _resolve_profile(req)
    t0 = time.monotonic()

    async def generate_chunks():
        async with semaphore:
            async for pcm_chunk in _synthesize_segments(req.text, profile, req.cache):
                yield pcm_chunk.tobytes()

    elapsed = time.monotonic() - t0
    logger.info(
        "stream request text_len=%d profile=%s duration=%.2fs",
        len(req.text),
        profile.id,
        elapsed,
    )

    return StreamingResponse(
        generate_chunks(),
        media_type="application/octet-stream",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": str(settings.TTS_SAMPLE_RATE),
            "X-Audio-Channels": "1",
        },
    )


@app.post("/v1/tts/wav", response_class=Response)
async def tts_wav(req: TTSWavRequest):
    global _request_count
    _request_count += 1
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    if semaphore is None:
        raise HTTPException(503, "service initializing")
    if _service_is_busy():
        raise HTTPException(429, "TTS engine busy, try again later")

    profile = _resolve_profile(req)
    t0 = time.monotonic()

    all_pcm = bytearray()
    async with semaphore:
        async for pcm_chunk in _synthesize_segments(req.text, profile, req.cache):
            all_pcm.extend(pcm_chunk.tobytes())

    pcm_array = np.frombuffer(all_pcm, dtype=np.int16)
    wav_bytes = audio_utils.wav_bytes(pcm_array, settings.TTS_SAMPLE_RATE)

    elapsed = time.monotonic() - t0
    logger.info(
        "wav request text_len=%d profile=%s bytes=%d duration=%.2fs",
        len(req.text),
        profile.id,
        len(wav_bytes),
        elapsed,
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Audio-Format": "wav",
            "X-Audio-Sample-Rate": str(settings.TTS_SAMPLE_RATE),
            "X-Audio-Channels": "1",
        },
    )


@app.post("/v1/cache/prime")
async def cache_prime(req: CachePrimeRequest):
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    if semaphore is None:
        raise HTTPException(503, "service initializing")

    profile_id = req.voice_profile_id or settings.TTS_DEFAULT_VOICE_PROFILE
    profile = get_profile(profile_id)
    if profile is None:
        raise HTTPException(404, f"voice profile not found: {profile_id}")

    cache = get_cache()
    reference_digest = _reference_digest(profile)

    def _gen(text: str):
        wav = engine.generate(text, profile)
        return audio_utils.float32_to_int16(wav)

    def _prime():
        count = 0
        for phrase in req.phrases:
            key = AudioCache.make_key(
                settings.VOXCPM_MODEL_ID,
                profile.id,
                profile.cfg_value,
                profile.inference_timesteps,
                profile.normalize,
                phrase,
                reference_digest,
                synthesis_cache_context(profile),
            )
            if cache.get(key) is None:
                audio = _gen(phrase)
                cache.put(key, audio)
                count += 1
        return count

    async with semaphore:
        newly_primed = await _run_synthesis_job(_prime)

    return {"primed": newly_primed, "total_phrases": len(req.phrases)}


# ---------------------------------------------------------------------------
# Compatibility endpoint: POST /generate
# Matches the contract expected by the VoxCPM bridge in the Express gateway.
# The bridge sends { target_text, speakingRate, ... } and expects streaming
# audio bytes back with an audio/* content type.
# ---------------------------------------------------------------------------


@app.post("/generate")
async def generate_compat(req: VoxCpmBridgeRequest, request: Request):
    global _request_count
    _request_count += 1
    """Compatibility endpoint for the Express gateway's VoxCPM bridge.

    The bridge calls POST /generate with { target_text } and expects
    streaming audio. We return raw PCM chunks matching the
    X-Audio-Format: pcm_s16le header.
    """
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    if semaphore is None:
        raise HTTPException(503, "service initializing")
    if _service_is_busy():
        raise HTTPException(429, "TTS engine busy, try again later")

    profile = get_profile(settings.TTS_DEFAULT_VOICE_PROFILE)
    if profile is None:
        raise HTTPException(500, "default voice profile not found")

    if req.reference_audio_path:
        profile = dataclasses.replace(
            profile, reference_audio_path=req.reference_audio_path
        )

    text = req.target_text
    speaking_rate = audio_utils.normalize_speaking_rate(req.speakingRate)
    generation_mode = (
        "cloned-synthesis" if profile.reference_audio_path else "profile-synthesis"
    )
    reference_audio_role = (
        "conditioning-only" if profile.reference_audio_path else "none"
    )
    t0 = time.monotonic()
    reference_digest = _reference_digest(profile)

    async def generate_chunks():
        global _cache_hits, _cache_misses
        bytes_sent = 0
        first_chunk_ms = None
        completed = False
        try:
            async with semaphore:
                segments = segment_text(
                    text,
                    max_chars=settings.TTS_MAX_SEGMENT_CHARS,
                    min_chars=settings.TTS_MIN_SEGMENT_CHARS,
                )
                cache = get_cache()
                for segment_index, seg in enumerate(segments):
                    cache_key = AudioCache.make_key(
                        settings.VOXCPM_MODEL_ID,
                        profile.id,
                        profile.cfg_value,
                        profile.inference_timesteps,
                        profile.normalize,
                        seg,
                        reference_digest,
                        synthesis_cache_context(profile),
                    )
                    pcm16 = cache.get(cache_key) if req.cache else None
                    loop = asyncio.get_running_loop()
                    cache_hit = pcm16 is not None
                    synthesis_ms = 0
                    if pcm16 is None:
                        if req.cache:
                            _cache_misses += 1
                        synthesis_started = time.monotonic()
                        wav = await _run_synthesis_job(engine.generate, seg, profile)
                        synthesis_ms = round(
                            (time.monotonic() - synthesis_started) * 1000
                        )
                        pcm16 = audio_utils.float32_to_int16(wav)
                        # Cache the unpaced synthesis so every requested tempo
                        # can reuse the same target speech without compounding
                        # time-stretch artifacts.
                        if req.cache:
                            cache.put(cache_key, pcm16)
                    else:
                        _cache_hits += 1

                    tempo_started = time.monotonic()
                    paced_pcm16 = await asyncio.wait_for(
                        loop.run_in_executor(
                            None,
                            audio_utils.apply_speaking_rate,
                            pcm16,
                            settings.TTS_SAMPLE_RATE,
                            speaking_rate,
                        ),
                        timeout=20.0,
                    )
                    tempo_ms = round((time.monotonic() - tempo_started) * 1000)
                    if first_chunk_ms is None:
                        first_chunk_ms = round((time.monotonic() - t0) * 1000)
                    logger.info(
                        "generate-compat-segment index=%d count=%d chars=%d "
                        "cache_enabled=%s cache_hit=%s synthesis_ms=%d tempo_ms=%d first_chunk_ms=%s",
                        segment_index,
                        len(segments),
                        len(seg),
                        req.cache,
                        cache_hit,
                        synthesis_ms,
                        tempo_ms,
                        first_chunk_ms if segment_index == 0 else None,
                    )
                    bytes_sent += paced_pcm16.nbytes
                    yield paced_pcm16.tobytes()
                completed = True
        finally:
            logger.info(
                "generate-compat outcome=%s text_len=%d profile=%s "
                "generation_mode=%s reference_audio_role=%s speaking_rate=%.2f "
                "first_chunk_ms=%s bytes=%d duration=%.2fs",
                "complete" if completed else "interrupted",
                len(req.target_text),
                profile.id,
                generation_mode,
                reference_audio_role,
                speaking_rate,
                first_chunk_ms,
                bytes_sent,
                time.monotonic() - t0,
            )

    return StreamingResponse(
        generate_chunks(),
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Voice-Speech-Provider": "voxcpm",
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": str(settings.TTS_SAMPLE_RATE),
            "X-Audio-Channels": "1",
            "X-Speaking-Rate-Applied": f"{speaking_rate:.2f}",
            "X-TTS-Generation-Mode": generation_mode,
            "X-Reference-Audio-Role": reference_audio_role,
        },
    )


# ---------------------------------------------------------------------------
# Reference audio endpoints for voice cloning
# ---------------------------------------------------------------------------

_REF_DIR = Path("/tmp/voxcpm-refs")


def _cleanup_old_refs() -> None:
    """Delete reference audio files older than 1 hour."""
    if not _REF_DIR.exists():
        return
    cutoff = time.time() - 3600
    for f in _REF_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


@app.post("/v1/reference-audio")
async def upload_reference_audio(request: Request):
    """Accept raw audio bytes, write to temp dir, return local path for voice cloning."""
    body = await request.body()
    if not body or len(body) < 100:
        raise HTTPException(400, "empty or too small audio body")
    if len(body) > 50 * 1024 * 1024:
        raise HTTPException(413, "audio too large (max 50MB)")

    _REF_DIR.mkdir(parents=True, exist_ok=True)

    filename = f"ref-{uuid.uuid4().hex[:12]}.wav"
    path = _REF_DIR / filename
    path.write_bytes(body)

    return {"path": str(path), "size": len(body)}


@app.post("/v1/reference-audio/download")
async def download_reference_audio(req: ReferenceAudioDownloadRequest):
    """Download reference audio from a URL (e.g., VoiceTrainer) and save locally."""
    import httpx

    _REF_DIR.mkdir(parents=True, exist_ok=True)

    filename = f"ref-{req.clip_id or uuid.uuid4().hex[:12]}.wav"
    path = _REF_DIR / filename

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(req.url)
        if resp.status_code != 200:
            raise HTTPException(
                502, f"Failed to download reference audio: HTTP {resp.status_code}"
            )
        path.write_bytes(resp.content)

    return {"path": str(path), "size": path.stat().st_size}


@app.post("/v1/reference-audio/prime")
async def prime_reference_audio(req: ReferenceAudioPrimeRequest):
    """Prepare selected-voice features without synthesizing placeholder audio."""
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    if semaphore is None:
        raise HTTPException(503, "service initializing")
    if _service_is_busy():
        raise HTTPException(429, "TTS engine busy, try again later")
    if not Path(req.reference_audio_path).is_file():
        raise HTTPException(404, "reference audio not found")

    started = time.monotonic()
    async with semaphore:
        cache_hit = await _run_synthesis_job(
            engine.prepare_reference,
            req.reference_audio_path,
        )
    prepare_ms = round((time.monotonic() - started) * 1000)
    logger.info(
        "reference prewarm cache_hit=%s prepare_ms=%d",
        cache_hit,
        prepare_ms,
    )
    return {
        "prepared": True,
        "cache_hit": cache_hit,
        "prepare_ms": prepare_ms,
    }


@app.get("/ready")
async def ready():
    """Readiness probe — the VoxCPM bridge checks /ready first, then /health."""
    if not engine.loaded:
        raise HTTPException(503, "model not loaded")
    return {"ready": True}


@app.get("/info")
async def info():
    """Model info — the VoxCPM bridge calls /info for diagnostics."""
    return {
        "engine": "voxcpm2",
        "model_id": settings.VOXCPM_MODEL_ID,
        "device": settings.VOXCPM_DEVICE,
        "sample_rate": settings.TTS_SAMPLE_RATE,
        "loaded": engine.loaded,
        "voice_profiles": list_profile_ids(),
        "optimize": settings.VOXCPM_OPTIMIZE,
        "denoiser": settings.VOXCPM_LOAD_DENOISER,
    }


@app.get("/metrics")
async def metrics():
    """Simple metrics endpoint."""
    total_cache = _cache_hits + _cache_misses
    return {
        "request_count": _request_count,
        "cache_hits": _cache_hits,
        "cache_misses": _cache_misses,
        "cache_hit_rate": _cache_hits / total_cache if total_cache > 0 else 0.0,
        "uptime_seconds": time.monotonic() - _start_time if _start_time else 0.0,
    }
