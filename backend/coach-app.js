(function(){
  'use strict';

  var debugLog = [];
  var debugPanel = null;
  var debugList = null;
  var DEBUG_MAX = 100;
  var debugFlushTimer = null;
  var debugPending = [];

  function dbg(cat, msg, data){
    var entry = { t: Date.now(), cat: cat, msg: msg, data: data || undefined };
    debugLog.push(entry);
    if(debugLog.length > DEBUG_MAX) debugLog.shift();
    appendDebugEntry(entry);
    debugPending.push(entry);
    if(!debugFlushTimer){
      debugFlushTimer = setTimeout(function(){
        debugFlushTimer = null;
        var batch = debugPending.splice(0);
        batch.forEach(function(e){ try{ fetch('/debug/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cat:e.cat,msg:e.msg,data:e.data})}).catch(function(){}); }catch(x){} });
      }, 500);
    }
  }
  var debugInited = false;
  function toggleDebugPanel(){
    debugPanel = debugPanel || document.getElementById('debug-panel'); if(!debugPanel) return;
    debugList = debugList || document.getElementById('debug-list');
    if(!debugInited && debugList){
      debugInited = true;
      for(var i = 0; i < debugLog.length; i++) appendDebugEntry(debugLog[i]);
      document.getElementById('dbg-close').onclick = function(){ debugPanel.style.display = 'none'; };
      document.getElementById('dbg-clear').onclick = function(){ debugLog.length = 0; while(debugList.firstChild) debugList.removeChild(debugList.firstChild); try{ fetch('/debug/clear',{method:'POST'}).catch(function(){}); }catch(e){} };
      document.getElementById('dbg-fetch-srv').onclick = function(){ fetch('/debug/pipeline').then(function(r){return r.json();}).then(function(d){ (d.events||[]).forEach(function(e){ appendDebugEntry({t:e.t,cat:'srv:'+e.cat,msg:e.msg,data:e.data}); }); }).catch(function(){}); };
    }
    var show = !debugPanel.style.display || debugPanel.style.display === 'none';
    debugPanel.style.display = show ? 'block' : 'none';
  }
  function appendDebugEntry(entry){
    if(!debugList) return;
    var isError = entry.cat === 'error' || entry.cat.indexOf('error') >= 0;
    var line = document.createElement('div');
    line.style.cssText = 'padding:1px 0;' + (isError ? 'color:#ff6b5b;' : '');
    var time = new Date(entry.t).toLocaleTimeString('en-US', { hour12: false }) + '.'
      + String(entry.t % 1000).padStart(3, '0');
    var catColor = '#7fb2f0';
    var cat = entry.cat;
    if(cat.indexOf('tts') >= 0) catColor = '#d5a840';
    else if(cat.indexOf('asr') >= 0) catColor = '#7fb283';
    else if(cat.indexOf('sse') >= 0) catColor = '#c8a8e0';
    else if(cat.indexOf('error') >= 0) catColor = '#ff6b5b';
    else if(cat.indexOf('session') >= 0) catColor = '#e0c878';
    var tSpan = document.createElement('span');
    tSpan.style.color = '#666';
    tSpan.textContent = time + ' ';
    var cSpan = document.createElement('span');
    cSpan.style.cssText = 'color:' + catColor + ';font-weight:600';
    cSpan.textContent = entry.cat + ' ';
    line.appendChild(tSpan);
    line.appendChild(cSpan);
    line.appendChild(document.createTextNode(entry.msg));
    if(entry.data){
      var dSpan = document.createElement('span');
      dSpan.style.color = '#888';
      dSpan.textContent = ' ' + JSON.stringify(entry.data).slice(0, 120);
      line.appendChild(dSpan);
    }
    debugList.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }

  document.addEventListener('keydown', function(e){
    if(e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')){
      e.preventDefault();
      toggleDebugPanel();
    }
  });

  dbg('session', 'loaded');
  function showError(msg){
    var banner = document.getElementById('error-banner');
    if(!banner) return;
    banner.querySelector('#error-msg').textContent = msg;
    banner.classList.remove('hidden'); banner.style.display = 'block';
    dbg('error', 'UI: ' + msg);
    setTimeout(function(){ banner.classList.add('hidden'); banner.style.display='none'; },8000);
  }
  var sessionId = null;
  var turnCount = 0;
  var state = 'idle';
  var recognition = null;
  var recognitionStarting = false;       // B3: guard against onend/onerror restart race
  var audioContext = null;               // mic-meter AudioContext
  var analyser = null;
  var micStream = null;
  var animFrame = null;
  var meterActive = false;               // S5: flag checked inside frame loop
  var meterFillEl = null;                // N4: cache DOM lookup
  var meterTrackEl = null;               // SF5: for aria-valuenow updates
  var playbackCtx = null;                // S2b: persistent per-session playback context
  var playbackSource = null;
  var referenceClipId = null;
  var turnInFlight = false;              // B1: spans entire turn (send→SSE→TTS→playback)
  var turnAbort = null;                  // B4: AbortController for the current turn
  var healthTimer = null;                // N1: periodic health check
  var lastPartialShown = '';             // S4: avoid redundant DOM writes for interim results
  var startAbort = null;                // abort in-flight session-start chain on End
  var startupEpoch = 0;
  var endedSessionIds = new Set();
  function $(id){ return document.getElementById(id); }
  function api(path, opts){
    opts = opts || {};
    var o = { headers: {} };
    if(opts.method) o.method = opts.method;
    if(opts.signal) o.signal = opts.signal;
    if(opts.body !== undefined){
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(opts.body);
    }
    return fetch(path, o).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function checkHealth(signal, epoch, controller){
    function ensureFreshStartup(){
      if(controller && !isCurrentStartup(epoch, controller)) throw abortError();
    }
    return api('/health', { signal: signal }).then(function(d){
      ensureFreshStartup();
      if(d.status === 'online'){
        $('conn').className = 'conn-badge online';
        $('conn-label').textContent = 'Connected';
        dbg('session', 'health: online');
        return true;
      }
      $('conn').className = 'conn-badge offline';
      $('conn-label').textContent = 'Backend: ' + (d.status || 'unknown');
      dbg('error', 'health: ' + d.status);
      return false;
    }).catch(function(err){
      if(err.name === 'AbortError') throw err;
      ensureFreshStartup();
      $('conn').className = 'conn-badge offline';
      $('conn-label').textContent = 'Cannot reach backend';
      dbg('error', 'health check failed: ' + err.message);
      showError('Cannot reach the voice tutor server. Check your connection.');
      return false;
    });
  }
  function startHealthPolling(){
    if(healthTimer) return;
    healthTimer = setInterval(checkHealth, 30000);
  }
  function stopHealthPolling(){
    if(healthTimer){ clearInterval(healthTimer); healthTimer = null; }
  }
  function isCurrentStartup(epoch, controller){
    return startAbort === controller && startupEpoch === epoch && !controller.signal.aborted;
  }
  function abortError(){
    var err = new Error('Startup cancelled');
    err.name = 'AbortError';
    return err;
  }
  function endSessionId(sid, transport){
    if(!sid || endedSessionIds.has(sid)) return;
    endedSessionIds.add(sid);
    if(transport === 'beacon'){
      var beaconBody = new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' });
      try{ navigator.sendBeacon('/voice/session/end', beaconBody); } catch(e){}
      return;
    }
    api('/voice/session/end', { method: 'POST', body: { sessionId: sid } }).catch(function(){});
  }
  function setState(s){
    var wasListening = state === 'listening';
    state = s;
    if(wasListening && s !== 'listening'){ stopRecognition(); }
    var dot = $('pulse-dot');
    var track = $('meter-track');
    dot.className = 'pulse-dot';
    track.className = 'meter-track';
    if(s === 'idle'){
      $('status-text').textContent = 'Ready to start.';
      $('turn-indicator').textContent = 'Press Start to begin.';
      $('turn-subtext').textContent = 'When it is your turn, speak naturally.';
      $('meter-hint').textContent = 'Speak to test the mic.';
    } else if(s === 'listening'){
      dot.classList.add('is-live');
      track.classList.add('is-listening');
      $('status-text').textContent = 'Listening...';
      $('turn-indicator').textContent = 'Your turn \u2014 listening.';
      $('turn-subtext').textContent = 'Speak naturally.';
      $('meter-hint').textContent = 'Mic is active.';
    } else if(s === 'thinking'){
      dot.classList.add('is-thinking');
      track.classList.add('is-passive');
      $('status-text').textContent = 'Coach is thinking...';
      $('turn-indicator').textContent = 'Processing...';
      $('turn-subtext').textContent = 'The coach heard you. Thinking...';
      $('meter-hint').textContent = 'Waiting for response.';
    } else if(s === 'speaking'){
      dot.classList.add('is-coach');
      track.classList.add('is-passive');
      $('status-text').textContent = 'Coach is speaking.';
      $('turn-indicator').textContent = 'Coach speaking.';
      $('turn-subtext').textContent = 'Listen, then respond when ready.';
      $('meter-hint').textContent = 'Coach is talking.';
    }
  }
  function startMicMeter(epoch, controller){
    meterFillEl = $('meter-fill');
    meterTrackEl = $('meter-track');
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Microphone access is not available.'));
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      if(!isCurrentStartup(epoch, controller)){
        stream.getTracks().forEach(function(t){ t.stop(); });
        throw abortError();
      }
      micStream = stream;
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      dbg('audio', 'mic meter started: ctx=' + audioContext.state + ' @ ' + audioContext.sampleRate + 'Hz');
      var source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      animateMeter();
    }).catch(function(err){
      if(err.name === 'AbortError') throw err;
      if(!isCurrentStartup(epoch, controller)) throw abortError();
      dbg('error', 'mic meter failed: ' + err.message);
      showError('Microphone access failed: ' + err.message);
      $('meter-hint').textContent = 'Mic unavailable: ' + err.message;
      throw err;
    });
  }
  function animateMeter(){
    if(!analyser) return;
    meterActive = true;
    var data = new Uint8Array(analyser.frequencyBinCount);
    var ariaCounter = 0;
    function frame(){
      if(!meterActive || !analyser) return;
      analyser.getByteFrequencyData(data);
      var sum = 0;
      for(var i = 0; i < data.length; i++) sum += data[i];
      var avg = sum / data.length / 255;
      if(meterFillEl) meterFillEl.style.transform = 'scaleX(' + Math.max(.03, avg) + ')';
      ariaCounter++;
      if(ariaCounter >= 30 && meterTrackEl){
        meterTrackEl.setAttribute('aria-valuenow', String(Math.round(avg * 100)));
        ariaCounter = 0;
      }
      animFrame = requestAnimationFrame(frame);
    }
    frame();
  }
  function stopMicMeter(){
    meterActive = false;
    if(animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    if(micStream){ micStream.getTracks().forEach(function(t){ t.stop(); }); micStream = null; }
    if(audioContext){ dbg('audio', 'mic meter stopping, closing AudioContext'); audioContext.close().catch(function(){}); audioContext = null; analyser = null; }
    if(meterFillEl) meterFillEl.style.transform = 'scaleX(.03)';
    if(meterTrackEl) meterTrackEl.setAttribute('aria-valuenow', '0');
  }
  function deferredRestart(){
    if(recognitionStarting) return;
    recognitionStarting = true;
    setTimeout(function(){
      recognitionStarting = false;
      if(sessionId && state === 'listening' && recognition){
        try{ recognition.start(); } catch(err){ /* already started */ }
      }
    }, 250);
  }
  function startRecognition(throwOnFailure){
    stopRecognition();
    recognitionStarting = false;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){
      $('status-text').textContent = 'Speech recognition not supported. Use Chrome or Edge.';
      return;
    }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = function(e){
      var interim = '', finalT = '';
      for(var i = e.resultIndex; i < e.results.length; i++){
        if(e.results[i].isFinal) finalT += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if(interim && interim !== lastPartialShown){
        lastPartialShown = interim;
        $('status-text').textContent = 'You: ' + interim;
        dbg('asr', 'interim: ' + interim.slice(0, 60));
      }
      if(finalT && finalT.trim()){
        lastPartialShown = '';
        dbg('asr', 'final: ' + finalT.trim().slice(0, 80));
        sendToCoach(finalT.trim());
      }
    };
    recognition.onerror = function(e){
      dbg('asr', 'error: ' + e.error);
      if(e.error === 'no-speech'){
        deferredRestart();
      } else if(e.error === 'not-allowed'){
        $('status-text').textContent = 'Microphone denied. Allow mic access and reload.';
        endSession();
      } else if(e.error !== 'aborted'){
        $('status-text').textContent = 'Speech error: ' + e.error;
      }
    };
    recognition.onend = function(){
      deferredRestart();
    };
    try{ recognition.start(); setState('listening'); } catch(err){
      $('status-text').textContent = 'Could not start speech recognition: ' + err.message;
      if(throwOnFailure) throw err;
    }
  }
  function stopRecognition(){
    if(recognition){ try{ recognition.abort(); } catch(err){} recognition = null; }
    recognitionStarting = false;
  }
  var SSE_DIAGNOSTIC_CODES = {
    SSE_DONE_ACCEPTED: true,
    SSE_MALFORMED_EVENT: true,
    SSE_INVALID_DONE: true,
    SSE_MISSING_DONE: true,
    SSE_STREAM_FAILURE_BEFORE_DONE: true,
    SSE_AFTER_DONE_EVENT: true,
    SSE_STREAM_FAILURE_AFTER_DONE: true
  };
  function sseDiagnostic(code, metadata){
    if(!SSE_DIAGNOSTIC_CODES[code]) throw new Error('Unknown SSE diagnostic');
    var safe = {};
    metadata = metadata || {};
    Object.keys(metadata).forEach(function(key){
      var value = metadata[key];
      if(typeof value !== 'number' && typeof value !== 'boolean') throw new Error('Unsafe SSE diagnostic metadata');
      safe[key] = value;
    });
    dbg('sse', code, safe);
  }
  function createSseEventParser(onData){
    var decoder = new TextDecoder();
    var line = '';
    var dataLines = [];
    var pendingCR = false;
    function dispatchEvent(){
      if(dataLines.length) onData(dataLines.join('\n'));
      dataLines = [];
    }
    function dispatchLine(){
      if(line === ''){
        dispatchEvent();
      } else if(line.charAt(0) !== ':' && line.indexOf('data:') === 0){
        var value = line.slice(5);
        if(value.charAt(0) === ' ') value = value.slice(1);
        dataLines.push(value);
      }
      line = '';
    }
    function scan(text){
      for(var i = 0; i < text.length; i++){
        var ch = text.charAt(i);
        if(pendingCR){
          pendingCR = false;
          dispatchLine();
          if(ch === '\n') continue;
        }
        if(ch === '\r') pendingCR = true;
        else if(ch === '\n') dispatchLine();
        else line += ch;
      }
    }
    return {
      push: function(value){ scan(decoder.decode(value, { stream: true })); },
      finish: function(){
        scan(decoder.decode());
        if(pendingCR){ pendingCR = false; dispatchLine(); }
        else if(line !== '') dispatchLine();
        dispatchEvent();
      }
    };
  }
  function endTurn(){
    turnInFlight = false;
    if(turnAbort){ try{ turnAbort.abort(); } catch(e){} turnAbort = null; }
  }
  function sendToCoach(text){
    if(!sessionId || turnInFlight) return;
    turnInFlight = true;
    setState('thinking');
    dbg('sse', '→ coach: ' + text.slice(0, 80));
    turnAbort = new AbortController();
    var turnController = turnAbort;
    var turnSessionId = sessionId;
    function isCurrentTurn(){
      return !!sessionId && sessionId === turnSessionId && turnAbort === turnController;
    }
    fetch('/voice/coach/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, message: text }),
      signal: turnController.signal
    }).then(function(response){
      if(!isCurrentTurn()) return;
      if(!response.ok) throw new Error('HTTP ' + response.status);
      var reader = response.body.getReader();
      var acceptedReply = null;
      var finalized = false;
      function finalizeAccepted(){
        if(!isCurrentTurn() || finalized || acceptedReply === null) return;
        finalized = true;
        turnCount++;
        $('turn-chip').textContent = String(turnCount);
        speakText(acceptedReply);
        showPhraseCard(acceptedReply);
        updateTrail(acceptedReply);
        showPhoneticTranscript(acceptedReply);
      }
      function resetRetryable(code){
        if(!isCurrentTurn()) return;
        sseDiagnostic(code, { retryable: true });
        showError('The coach response was interrupted. Please try again.');
        endTurn();
        setState('listening');
        startRecognition();
      }
      function handleEvent(payload){
        if(!isCurrentTurn()) return;
        if(acceptedReply !== null){
          sseDiagnostic('SSE_AFTER_DONE_EVENT', { ignored: true });
          return;
        }
        if(payload === '[DONE]') return;
        var data;
        try{ data = JSON.parse(payload); }
        catch(err){ sseDiagnostic('SSE_MALFORMED_EVENT', { skipped: true }); return; }
        if(data && data.done === true){
          var message = data.session && data.session.coachMessage;
          if(typeof message === 'string' && message.trim()){
            acceptedReply = message;
            sseDiagnostic('SSE_DONE_ACCEPTED', { length: message.length });
          } else {
            sseDiagnostic('SSE_INVALID_DONE', {
              hasSession: !!(data && data.session),
              stringMessage: typeof message === 'string',
              nonemptyMessage: typeof message === 'string' && !!message.trim()
            });
          }
        } else if(data && typeof data.chunk === 'string'){
          $('status-text').textContent = 'Coach response received. Finalizing...';
        }
      }
      var parser = createSseEventParser(handleEvent);
      function readChunk(){
        return reader.read().then(function(result){
          if(!isCurrentTurn()) return;
          if(result.done){
            parser.finish();
            if(acceptedReply !== null) finalizeAccepted();
            else resetRetryable('SSE_MISSING_DONE');
            return;
          }
          parser.push(result.value);
          return readChunk();
        }).catch(function(err){
          if(err.name === 'AbortError' || !isCurrentTurn()) return;
          if(acceptedReply !== null){
            sseDiagnostic('SSE_STREAM_FAILURE_AFTER_DONE', { preserved: true });
            finalizeAccepted();
          } else {
            resetRetryable('SSE_STREAM_FAILURE_BEFORE_DONE');
          }
        });
      }
      return readChunk();
    }).catch(function(err){
      if(err.name === 'AbortError' || !isCurrentTurn()) return;
      sseDiagnostic('SSE_STREAM_FAILURE_BEFORE_DONE', { retryable: true });
      showError('The coach connection was interrupted. Please try again.');
      endTurn();
      setState('listening');
      startRecognition();
    });
  }
  function ensurePlaybackCtx(){
    if(playbackCtx && playbackCtx.state !== 'closed') return playbackCtx;
    playbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    dbg('audio', 'playback ctx created: ' + playbackCtx.state + ' @ ' + playbackCtx.sampleRate + 'Hz');
    if(playbackCtx.state === 'suspended'){
      dbg('audio', 'playback ctx suspended — calling resume()');
      playbackCtx.resume().then(function(){ dbg('audio', 'playback ctx resumed'); }).catch(function(e){ dbg('error', 'playback ctx resume failed: ' + e.message); });
    }
    return playbackCtx;
  }
  function preparePlaybackCtx(){
    if(!playbackCtx || playbackCtx.state === 'closed'){
      playbackCtx = new (window.AudioContext || window.webkitAudioContext)();
      dbg('audio', 'playback ctx created: ' + playbackCtx.state + ' @ ' + playbackCtx.sampleRate + 'Hz');
    }
    var ctx = playbackCtx;
    var ready = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return Promise.resolve(ready).then(function(){
      if(ctx.state !== 'running') throw new Error('Audio playback is not ready.');
      return ctx;
    });
  }
  function speakText(text){
    setState('speaking');
    dbg('tts', '→ /voice/tts', { len: text.length, hasRef: !!referenceClipId });
    var ttsAbort = turnAbort;
    fetch('/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, referenceClipId: referenceClipId || undefined }),
      signal: ttsAbort ? ttsAbort.signal : undefined
    }).then(function(r){
      if(!r.ok) throw new Error('TTS HTTP ' + r.status);
      var ct = r.headers.get('content-type') || '';
      dbg('tts', 'response: ' + r.status + ' ' + ct);
      return r.arrayBuffer();
    }).then(function(buffer){
      dbg('tts', 'audio bytes: ' + buffer.byteLength);
      if(!sessionId){ endTurn(); return; }
      var ctx = ensurePlaybackCtx();
      dbg('tts', 'AudioContext: ' + ctx.state + ' @ ' + ctx.sampleRate + 'Hz');
      return ctx.decodeAudioData(buffer).then(function(decoded){
        dbg('tts', 'decoded: ' + decoded.duration.toFixed(2) + 's, ' + decoded.sampleRate + 'Hz, ' + decoded.numberOfChannels + 'ch');
        if(decoded.sampleRate < 8000){
          throw new Error('Invalid audio sample rate: ' + decoded.sampleRate);
        }
        var source = ctx.createBufferSource();
        source.buffer = decoded;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.02);  // 20ms fade-in
        var dur = decoded.duration;
        gain.gain.setValueAtTime(1, ctx.currentTime + Math.max(0, dur - 0.02));
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
        source.connect(gain);
        gain.connect(ctx.destination);
        playbackSource = source;
        source.onended = function(){
          dbg('tts', 'playback ended');
          if(playbackSafety){ clearTimeout(playbackSafety); playbackSafety = null; }
          playbackSource = null;
          if(!sessionId){ endTurn(); return; }  // tearing down — don't restart
          endTurn();
          setState('listening');
          startRecognition();
        };
        source.start(0);
        dbg('tts', 'playback started, duration=' + dur.toFixed(2) + 's');
        var playbackSafety = setTimeout(function(){
          if(playbackSource === source){
            try{ source.stop(); } catch(e){}  // triggers onended if still alive
            playbackSource = null;
            endTurn();
            if(sessionId){ setState('listening'); startRecognition(); }
          }
        }, (dur + 5) * 1000);
      });
    }).catch(function(err){
      if(err.name === 'AbortError'){ dbg('tts', 'aborted (session ended)'); return; }
      dbg('error', 'TTS/playback failed: ' + err.message, { type: err.name });
      showError('Audio playback failed: ' + err.message);
      if(playbackSource){ try{ playbackSource.stop(); } catch(e){} playbackSource = null; }
      if(!sessionId){ endTurn(); return; }  // S5: tearing down — don't restart
      endTurn();
      setState('listening');
      startRecognition();
    });
  }
  var voiceQuality = null;  // stored quality metrics for coach awareness
  var presetId = null;      // saved preset ID for persistence
  function showQualityFeedback(q, cleaningData){
    if(!q) return;
    var note = document.getElementById('voice-quality-note');
    if(!note) return;
    while(note.firstChild) note.removeChild(note.firstChild);
    var verdict = q.verdict || 'unknown';
    var color = verdict === 'good' ? '#7fb283' : verdict === 'acceptable' ? '#d5a840' : '#ba4b2f';
    var flags = (q.flags || []).join(', ');
    note.appendChild(document.createTextNode('Quality: '));
    var v = document.createElement('strong'); v.style.color = color; v.textContent = verdict; note.appendChild(v);
    note.appendChild(document.createTextNode(' · ' + Math.round(q.meanLoudnessDb||0) + 'dB · ' + Math.round((q.voicedCoveragePct||0)*100) + '% voiced'));
    if(flags) note.appendChild(document.createTextNode(' · ' + flags));
    // Audio cleaning report
    if(cleaningData && cleaningData.cleaned){
      note.appendChild(document.createElement('br'));
      var c = document.createElement('span');
      c.style.cssText = 'font-size:.72rem;color:#7fb283';
      c.textContent = '✓ Audio cleaned (noise reduction + volume normalized)';
      note.appendChild(c);
    }
    note.appendChild(document.createElement('br'));
    var s = document.createElement('span'); s.style.cssText = 'font-size:.72rem;color:var(--muted)'; s.textContent = q.summary || ''; note.appendChild(s);
  }
  function uploadVoiceSample(file){
    var link = document.getElementById('voice-sample-link');
    if(link.disabled) return;
    link.disabled = true;
    link.textContent = 'Analyzing...';
    var form = new FormData();
    form.append('file', file);
    fetch('/voice/upload-reference', { method: 'POST', body: form })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d){
        referenceClipId = d.clipId; voiceQuality = d.quality || null;
        dbg('session', 'voice sample: ' + (voiceQuality ? voiceQuality.verdict : 'no quality'), voiceQuality || undefined);
        if(d.trimmed){
          dbg('session', 'audio trimmed: ' + d.originalDurationSec.toFixed(1) + 's → ' + d.trimmedToSec + 's');
          showError(d.trimWarning);
        }
        showQualityFeedback(voiceQuality, d);
        link.textContent = 'Voice set (' + Math.round((d.durationMs||0)/1000) + 's)';
        link.style.color = '#7fb283';
        link.disabled = false;
        return fetch('/voice/presets/reference/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referenceClipId: d.clipId,
            name: 'My Voice',
            // The app's default target, and the value every other table falls
            // back to. This said 'androgynous' — which based every saved voice
            // against a target the learner had not chosen, and which the analyzer
            // is about to stop recognising at all (it raises, i.e. HTTP 400 on
            // "save my voice"). Wrong on both counts; 'cute-feminine' is the
            // documented default here and in normalizeVoiceTutorTargetPreset.
            basePreset: 'cute-feminine',
            sourceLabel: 'coach-page',
            referenceAnalysis: d,
          }),
        });
      })
      .then(function(r){ if(!r.ok) throw new Error('preset HTTP ' + r.status); return r.json(); })
      .then(function(preset){
        presetId = preset.id || null;
        if(presetId){ try{ localStorage.setItem('coachPresetId', presetId); } catch(e){} }
        dbg('session', 'preset saved: ' + (preset.name || presetId));
      })
      .catch(function(err){
        dbg('error', 'voice sample/preset failed: ' + err.message);
        showError('Voice sample upload failed: ' + err.message);
        link.textContent = 'Set your preferred voice';
        link.disabled = false;
        var note = document.getElementById('voice-quality-note');
        if(note) note.textContent = 'Upload failed: ' + err.message;
      });
  }
  function startSession(){
    if(sessionId || state !== 'idle' || startAbort) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){
      $('status-text').textContent = 'Speech recognition not supported. Use Chrome or Edge.';
      showError('Speech recognition is not supported. Use Chrome or Edge.');
      return;
    }
    dbg('session', 'starting...');
    $('start-btn').disabled = true;
    $('end-btn').disabled = false;
    document.body.setAttribute('data-ready', 'false');
    $('status-text').textContent = 'Starting session...';
    startAbort = new AbortController();  // abortable so End can cancel mid-start
    var controller = startAbort;
    var sig = controller.signal;
    var epoch = ++startupEpoch;
    preparePlaybackCtx().then(function(){
      if(!isCurrentStartup(epoch, controller)) throw abortError();
      return checkHealth(sig, epoch, controller);
    }).then(function(healthy){
      if(!isCurrentStartup(epoch, controller)) throw abortError();
      if(!healthy) throw new Error('Voice tutor server is offline.');
      return api('/voice/real-sentence', { signal: sig });
    }).then(function(){
      if(!isCurrentStartup(epoch, controller)) throw abortError();
      return startMicMeter(epoch, controller);
    }).then(function(){
      if(!isCurrentStartup(epoch, controller)) throw abortError();
      return api('/voice/session/start', {
        method: 'POST',
        signal: sig,
        body: { learnerName: 'learner', mode: 'conversation_practice' }
      });
    }).then(function(d){
      var sid = d.sessionId || (d.payload && d.payload.sessionId);
      if(!sid) throw new Error('No sessionId');
      if(!isCurrentStartup(epoch, controller)){
        endSessionId(sid, 'normal');
        return;
      }
      sessionId = sid;
      dbg('session', 'started: ' + sessionId);
      startRecognition(true);
      $('session-chip').textContent = 'Active';
      $('mode-chip').textContent = 'Voice';
      $('end-btn').disabled = false;
      document.body.setAttribute('data-ready', 'true');
      startHealthPolling();  // N1
    }).catch(function(err){
      if(err.name === 'AbortError' || !isCurrentStartup(epoch, controller)) return;  // End clicked during startup — expected
      if(isCurrentStartup(epoch, controller)) endSession();
      showError('Session start failed: ' + err.message);
    }).finally(function(){
      if(startAbort === controller) startAbort = null;
    });
  }
  function endSession(){
    var sid = sessionId;
    dbg('session', 'ending: ' + (sid || 'none'));
    startupEpoch++;
    if(startAbort){ try{ startAbort.abort(); } catch(e){} startAbort = null; }
    stopRecognition();
    stopMicMeter();
    if(playbackSource){ try{ playbackSource.stop(); } catch(e){} playbackSource = null; }
    endTurn();
    if(playbackCtx){ try{ playbackCtx.close(); } catch(e){} playbackCtx = null; }
    sessionId = null;
    if(sid) endSessionId(sid, 'normal');
    stopHealthPolling();  // N1
    turnCount = 0;
    $('session-chip').textContent = 'Idle';
    $('mode-chip').textContent = 'Waiting';
    $('turn-chip').textContent = '0';
    $('start-btn').disabled = false;
    $('end-btn').disabled = true;
    document.body.setAttribute('data-ready', 'true');
    setState('idle');
    // Clean up UI state from bridge additions
    var phraseCardEl = document.getElementById('phrase-card');
    var trailElClean = document.getElementById('trail');
    if(phraseCardEl) phraseCardEl.classList.remove('visible');
    if(trailElClean) trailElClean.style.opacity = '0';
  }
  $('start-btn').addEventListener('click', startSession);
  $('end-btn').addEventListener('click', endSession);
  window.addEventListener('beforeunload', function(){
    if(sessionId) endSessionId(sessionId, 'beacon');
  });
  var voiceSampleLink = document.getElementById('voice-sample-link');
  if(voiceSampleLink){
    voiceSampleLink.addEventListener('click', function(e){
      e.preventDefault();
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.onchange = function(){ if(input.files[0]) uploadVoiceSample(input.files[0]); };
      input.click();
    });
  }
  document.body.setAttribute('data-ready', 'true');
  checkHealth();
  (function loadSavedPreset(){
    var savedId = null; try{ savedId = localStorage.getItem('coachPresetId'); } catch(e){}
    fetch('/voice/presets').then(function(r){ return r.json(); }).then(function(d){
      var presets = Array.isArray(d) ? d : (d.presets || d.items || []);
      if(!presets.length) return;
      var p = savedId ? presets.filter(function(x){ return x.id === savedId; })[0] : null;
      if(!p) p = presets[0]; if(!p) return;
      if(p.referenceClipId){
        referenceClipId = p.referenceClipId; presetId = p.id;
        var link = document.getElementById('voice-sample-link');
        if(link){ link.textContent = 'Voice loaded (' + Math.round((p.targetVoiceProfile||{}).durationMs/1000||0) + 's)'; link.style.color = '#7fb283'; }
        dbg('session', 'loaded preset: ' + (p.name || p.id));
      }
      if(p.referenceAnalysis && p.referenceAnalysis.quality){ voiceQuality = p.referenceAnalysis.quality; showQualityFeedback(voiceQuality); }
    }).catch(function(){ dbg('session', 'no saved presets'); });
  })();

  /* ═══════════════════════════════════════════════════════════
     BRIDGE: Preset selector + Composer + Slide-in cards
     Runs inside the IIFE so it can access referenceClipId,
     presetId, voiceQuality, sendToCoach(), and dbg().
     ═══════════════════════════════════════════════════════════ */

  /* --- Preset selector live switching --- */
  var presetSelect = document.getElementById('preset-select');
  if(presetSelect){
    presetSelect.addEventListener('change', function(){
      var id = this.value;
      if(!id) return;
      fetch('/voice/presets').then(function(r){ return r.json(); }).then(function(d){
        var presets = Array.isArray(d) ? d : (d.presets || d.items || []);
        for(var i = 0; i < presets.length; i++){
          if(presets[i].id === id){
            var p = presets[i];
            if(p.referenceClipId){
              referenceClipId = p.referenceClipId;
              presetId = p.id;
              var link = document.getElementById('voice-sample-link');
              if(link){
                var dur = Math.round(((p.targetVoiceProfile||{}).durationMs||0)/1000);
                link.textContent = dur ? (p.name||p.id)+' ('+dur+'s)' : (p.name||p.id);
                link.style.color = '#7fb283';
              }
              if(p.referenceAnalysis && p.referenceAnalysis.quality){
                voiceQuality = p.referenceAnalysis.quality;
                showQualityFeedback(voiceQuality);
              }
              dbg('preset', 'switched to: ' + (p.name || p.id));
            }
            break;
          }
        }
      }).catch(function(err){ dbg('error', 'preset fetch: ' + err.message); });
    });
  }

  /* --- Phonetic transcript: show coach reply in pronunciation spelling ---
     toPhonetic() is loaded from /static/phonetic-dict.js (separate file).
     This function only handles the DOM display. */
  var phoneticEl = document.getElementById('phonetic-transcript');

  function showPhoneticTranscript(text){
    if(!phoneticEl || !text) return;
    var phonetic = toPhonetic(text);
    if(!phonetic) return;
    // Split into lines of ~8 words for readability
    var words = phonetic.split(' ');
    var lines = [];
    for(var i = 0; i < words.length; i += 8){
      lines.push(words.slice(i, i + 8).join(' '));
    }
    var html = '<span class="phonetic-label">Coach says:</span>';
    for(var j = 0; j < lines.length; j++){
      html += '<span class="phonetic-line">' + lines[j] + '</span>';
    }
    phoneticEl.innerHTML = html;
    phoneticEl.classList.add('visible');
    // Clear any existing timer
    if(phoneticEl._timer){ clearTimeout(phoneticEl._timer); }
    // Stay visible during speaking, fade after return to listening
    phoneticEl._timer = setTimeout(function(){
      phoneticEl.classList.remove('visible');
    }, 12000);
  }

  /* --- Slide-in cards: show coach reply in phrase card --- */
  var phraseBody = document.getElementById('phrase-body');
  var phraseCard = document.getElementById('phrase-card');
  function showPhraseCard(text){
    if(!phraseBody || !phraseCard || !text) return;
    phraseBody.textContent = text;
    phraseCard.classList.add('visible');
    setTimeout(function(){ phraseCard.classList.remove('visible'); }, 8000);
  }

  /* --- Receded trail: show last coach turn above orb --- */
  var trailEl = document.getElementById('trail');
  function updateTrail(text){
    if(!trailEl || !text) return;
    var short = text.length > 60 ? text.slice(0, 60) + '…' : text;
    trailEl.textContent = short;
    trailEl.style.opacity = '1';
    setTimeout(function(){ trailEl.style.opacity = '0'; }, 5000);
  }

  /* --- Test Voice button: generate sample TTS with current preset --- */
  var testBtn = document.getElementById('test-voice-btn');
  if(testBtn){
    testBtn.addEventListener('click', function(){
      if(!referenceClipId){
        dbg('preset', 'test voice: no referenceClipId loaded');
        showPhraseCard('Select a voice preset first, then test it.');
        return;
      }
      // Prevent double-click
      if(testBtn.disabled) return;
      testBtn.disabled = true;
      var originalText = testBtn.textContent;
      testBtn.textContent = 'Generating…';

      var phraseIdx = Math.floor(Math.random() * 3);
      dbg('preset', 'test voice: clipId=' + referenceClipId + ' phrase=' + phraseIdx);

      fetch('/voice/presets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceClipId: referenceClipId, phraseIndex: phraseIdx })
      }).then(function(r){
        if(!r.ok) throw new Error('Test voice HTTP ' + r.status);
        var testText = r.headers.get('X-Test-Phrase-Text') || 'Test phrase';
        return r.arrayBuffer().then(function(buf){
          return { buffer: buf, text: testText };
        });
      }).then(function(result){
        dbg('preset', 'test voice: got ' + result.buffer.byteLength + ' bytes');
        // Play the audio
        var ctx = ensurePlaybackCtx();
        return ctx.decodeAudioData(result.buffer).then(function(decoded){
          var source = ctx.createBufferSource();
          source.buffer = decoded;
          var gain = ctx.createGain();
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.02);
          gain.gain.setValueAtTime(1, ctx.currentTime + Math.max(0, decoded.duration - 0.05));
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + decoded.duration);
          source.connect(gain);
          gain.connect(ctx.destination);
          source.start(0);
          // Show the test phrase in the card
          showPhraseCard('🔊 Test: "' + result.text.slice(0, 80) + '"');
          dbg('preset', 'test voice playing: ' + decoded.duration.toFixed(1) + 's');
        });
      }).catch(function(err){
        dbg('error', 'test voice failed: ' + err.message);
        showPhraseCard('Voice test failed: ' + err.message);
      }).finally(function(){
        testBtn.disabled = false;
        testBtn.textContent = originalText;
      });
    });
  }
})();
