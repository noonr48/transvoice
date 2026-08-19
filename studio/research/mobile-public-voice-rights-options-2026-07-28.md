# TransVoice public-mobile voice strategy

Decision research · 28 July 2026 · Australia-first, with US, EU/EEA, UK and
Apple/Google distribution exposure.

> This is product and engineering decision support, not legal advice. A public
> launch needs advice from qualified counsel in each enabled market.

## Recommendation awaiting owner approval

| Control | Position |
|---|---|
| Status | **Recommendation, not a ratified product decision or launch authorization** |
| Decision owner | TransVoice product owner |
| Decision deadline | Before commissioning performers, reusing an existing reference in new synthesis, or implementing a public/mobile release lane |
| Approve or reject | (1) launch route B-H/B-S; (2) defer route C and reject route A for public use; (3) run an Australia-only, adult-only closed pilot with server-side TTS; (4) supersede the current uploaded-reference contract for the public build and quarantine uncleared references |
| Work this memo authorizes by itself | None. The owner may separately authorize counsel review, route-hardening design, model/device spikes, and rights-dossier templates. |
| Deferred | Public launch, performer engagement, personal cloning, minors, non-Australian service, and on-device performer-specific assets |
| Not decided here | Which performers/vendor/model to use, budget, release date, marketing claims, or final service targets |

The supporting reasoning ledger is
[closed as a research recommendation](../../.deepthink/mobile-public-voice-rights-2026-07-28.md);
an owner ruling should be recorded in the project ledger before implementation.

Do **not** publicly launch “upload any goal voice” backed only by an uploader
checkbox.

The best public-capable rollout is **B first, then possibly C**:

1. Launch with a small, closed catalogue of adult voices that are either:
   - **B-H:** commissioned under a purpose-specific synthetic-voice agreement;
     or
   - **B-S:** designed without an intended real-person target and released only
     after provenance, stability and resemblance review. Residual resemblance
     risk remains.
2. Keep VoxCPM2 server-side for the first release. Keep the separate ~1B coach
   model server-side initially too, then move the coach on-device when its phone
   gate passes.
3. Make bounded, server-authored lesson text a release gate. The current Coach
   UI is bounded, but the server boundary is **not yet enforced**: authorized
   clients can submit synthesis text, and legacy routes add weaker paths. The
   public build must expose no general-purpose TTS API, free-text composer,
   public sharing, calls, messages, or audio export.
4. Later pilot **C**, personal cloning, only when the voice subject participates
   directly:
   - an adult records their own voice; or
   - another adult accepts an invitation, signs the scoped release, and records
     a fresh randomized consent/reference phrase themselves.
5. Exclude celebrities, public figures, recognisable character voices, deceased
   people, scraped/public-source clips, and minors from cloning at launch.

The strongest launch catalogue is probably a mix of:

- two or three commissioned voices, because they give the product intentionally
  coached, stable and human-approved targets; and
- two or three designed-synthetic voices, because they reduce dependency on
  any one performer and let the team test whether users value acoustic traits
  more than a named human identity.

Give learner-facing choices neutral invented names plus audition samples. Do
not use “sound like [person]”; do not use quality-only labels such as “bright,”
“warm,” or “light,” which conflict with TransVoice's
[cue-vocabulary law](../specs/cue-vocabulary-spec-2026-07-27.md). Acoustic
descriptors may remain internal metadata.

**Aster policy status: QUARANTINED; technical enforcement is pending owner
authorization.** Its tracked WAV has a hash but the current project record
contains no source URL, speaker/channel identity, capture receipt, licence or
permission evidence. A YouTube origin was an unverified working assumption, not
an auditable fact. Until a provenance/rights ledger and counsel-approved basis
exist, perform no new Aster synthesis, demo,
distribution, model work or public use. Preserve only the minimal restricted
evidence hold approved by the product owner/counsel; otherwise delete it on
their documented schedule. If a YouTube source is recovered, YouTube's
[Terms of Service](https://uk.youtube.com/t/terms) and Apple's
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
still require separate analysis; “internal” is not permission.

## Stable option taxonomy

| ID | Product mechanism | Recommendation |
|---|---|---|
| A | Any user uploads any third party's goal voice | Reject for public use |
| B-H | Closed catalogue of commissioned adult human voices | Preferred launch lane |
| B-S | Closed catalogue designed without an intended real-person target | Preferred parallel launch lane, conditional on screening and model provenance |
| C | Adult own-voice or invited-adult subject-controlled cloning | Defer to a later, separately gated pilot |
| D | Current private/server research baseline | Keep isolated while public gates are built; it is not a public rights position |

Server versus on-device inference is a separate **deployment axis**, not a fifth
voice-rights option. “B first, then C” names the rollout.

## The key correction: a voice is not one copyright problem

“Who owns the copyright in the voice?” collapses at least six different
questions:

| Layer | What must be cleared or controlled |
|---|---|
| Source material | Copyright in the recording, spoken script, music, film or broadcast; source-site terms |
| Person and performance | Performer authorization, moral rights, personality/publicity rights, passing off and false endorsement |
| Personal data | Raw audio, transcripts, embeddings/conditioning state, account and inferred gender/health context |
| Product conduct | What TransVoice itself generates, how it markets the voice, misuse prevention, takedown and consumer claims |
| Model and data | Code/weight licence, training-corpus provenance, output restrictions, redistribution and vendor terms |
| Distribution | Apple/Google AI, privacy, IP, health, impersonation, reporting and disclosure rules |

A human voice as an identity is generally not itself a copyrighted “work” in
the same way as a sound recording. That does not make cloning it free. The
source recording can be copyrighted while the person's identity is protected
through a different body of law.

Australia's current [Copyright Act 1968](https://www.legislation.gov.au/C1968A00063/latest/text)
gives the recording owner exclusive rights including copying. Section 113B
deems a performer licence or permission where consent to record was for a
particular purpose and the recording is used for that purpose under the consent
terms; it does **not** itself resolve synthetic generation or other owners'
rights.
The [Australian Law Reform Commission](https://www.alrc.gov.au/publication/serious-invasions-of-privacy-in-the-digital-era-alrc-report-123/12-remedies-and-costs/no-recommendation-on-notional-licence-fee/)
notes that Australia has no standalone right of publicity, but passing off and
other law can still address unauthorised commercial persona use.

The same separation appears elsewhere. The
[US Copyright Office's Digital Replicas report](https://copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-1-Digital-Replicas-Report.pdf)
describes a state-law patchwork and gaps in federal protection; the proposed
[House](https://www.congress.gov/bill/119th-congress/house-bill/2794) and
[Senate](https://www.congress.gov/bill/119th-congress/senate-bill/1367) NO FAKES
Acts remain introduced bills, not current law.

## Option matrix

| ID and route | User value | Rights controllability | Privacy/abuse load | Phone fit now | Public-launch view |
|---|---|---|---|---|---|
| A — any third-party clip + checkbox | Very high choice | Very low | Critical | Server only | **No-go** |
| C-own — adult's own fresh voice | Moderate; not always a “goal” | High | Medium | Server now; smaller clone model later | Deferred controlled-pilot candidate |
| C-invite — separately invited adult speaker | High | Medium-high if subject-led | High operational load | Server now | Deferred limited-pilot candidate |
| B-H — commissioned adult actor catalogue | High enough if catalogue is well designed | High with bespoke contract | Low-medium | Server now; offline only if contract permits distributed assets | **Preferred launch route** |
| B-S — designed-synthetic catalogue | Medium-high if acoustically useful | Lower persona risk, conditional on resemblance and base-model provenance | Low-medium | Server now | **Preferred parallel route** |
| B-V — vendor standard/custom catalogue | Medium | Contract-dependent | Medium processor/vendor load | Cloud | Conditional B alternative |
| B-P — Apple/Android system catalogue | Low-to-medium and inconsistent | High for invoking the platform service | Low | Excellent | Fallback/prototype, not exact-voice product |
| D — current private/server research setup | High for the owner | Not a public rights position | Current upload and caller-text routes remain | Working synthesis/routing; perceived identity remains open | Keep isolated while launch gates are built |

### Why arbitrary upload fails

The issue is not that a checkbox is never legally useful. A clear, logged
electronic acceptance can help when the actual speaker is the person accepting
it. A checkbox selected by a different uploader cannot establish that:

- the uploader is the recorded speaker;
- the speaker agreed to cloning rather than merely being recorded;
- the speaker is an adult with capacity;
- the uploader owns or licensed the source recording and underlying script;
- consent covers this product, generated novel speech, processors, territory,
  commercial use and term;
- the speaker is not a public figure, deceased person or minor;
- consent has not been withdrawn.

It is therefore only a supplementary uploader warranty and abuse signal. It is
not the chain of title.

The product also does more than passively store a file: TransVoice conditions a
model on it and generates new speech. Copyright hosting safe harbours, even
where available, do not grant permission and do not cure personality,
biometric/privacy, consumer-deception or app-store issues.

### Why commissioned presets are viable

They turn an unbounded provenance problem into a small auditable rights ledger.
The performer knows the application, can approve the initial model, is paid for
synthetic use, and can agree to bounded novel speech. That is materially
different from buying a generic voiceover session or downloading an “open”
single-speaker dataset.

An open-data copyright licence is not necessarily a digital-replica release.
Creative Commons itself explains in its [FAQ](https://creativecommons.org/faq/)
that CC material comes without warranties and that privacy, publicity,
personality, trademark and other permissions may still be required. Do not turn
a recognisable Common Voice, LibriTTS or other public-dataset speaker into a
commercial preset without a fresh direct agreement.

### Why B-S designed-synthetic voices are a viable catalogue lane

VoxCPM2 now supports “Voice Design” from a text description without reference
audio. Its [official repository](https://github.com/OpenBMB/VoxCPM) describes
voice design, cloning, Apache-2.0 code/weights, 2B parameters and 30 languages.

A direct Voice Design prompt is a **candidate generator**, not yet a stable
preset. The upstream project warns that Voice Design can vary between runs.
After selection, freeze a versioned master clip/conditioning identity (or train
a fixed model), bind it to the same exact-target record used by the app, and
prove identity consistency across representative lesson lines. Do not
re-generate a supposed identity from its description on every turn.

A defensible process would:

1. Use only generic acoustic descriptors, never a celebrity, actor, influencer,
   character, performer blend or “X-like” prompt.
2. Preserve model version, prompt, seed, candidate generations and selection
   decisions.
3. Give the voice an invented neutral label and no fictional biography implying
   a real speaker.
4. Pass `SIM-01`, the documented resemblance and stability gate below.
5. Re-screen after model, language, accent, emotion or style changes.
6. Label and machine-mark it as synthetic, and maintain a complaint/quarantine
   path.

This reduces performer, endorsement and personality risk. It does not eliminate
coincidental resemblance or base-model/data provenance risk.

#### SIM-01 — designed-voice screening and stability gate

“Designed without an intended real-person target” describes the process, not a
guarantee that nobody will recognise a person. Before a B-S voice ships:

- **Comparison sets:** compare it with every TransVoice human/candidate voice,
  licensed commercial catalogue comparators, and a lawfully assembled
  high-risk/public-figure blocklist relevant to the enabled market.
- **Automated method:** record the embedding model/version and calibrate its
  similarity threshold on named positive and negative validation pairs before
  testing candidates. There is no honest universal numeric threshold; the
  Voice QA lead must pre-register the tool-specific cutoff and error results.
- **Independent panel:** at least five listeners hear randomized, blind,
  level-matched samples. Reject if two independently name the same real person
  or commercial persona, or if any escalated match is confirmed as materially
  similar by the rights reviewer.
- **Stability:** compare at least 20 representative lesson lines across the
  intended language/style range against the frozen identity. Voice QA must
  pre-register the speaker-similarity acceptance band and pass all safety-
  critical identity checks before listening results are unblinded.
- **Evidence and decision:** retain prompts, seeds, model hashes, generated
  candidates, lawful comparison-set manifest, scores, panel forms and the
  rights review in the per-voice dossier. Voice QA owns the run; product and
  rights counsel approve release.
- **Failure and rerun:** quarantine/reject a failed candidate. Re-run after any
  model, checkpoint, conditioning, language, accent, emotion or style change,
  or after a credible resemblance complaint.

This screen reduces risk; it does not confer legal clearance.

## Recommended subject-led cloning flow

Do not let one account upload another person's clip and assert authority. Use an
invitation flow in which the voice subject acts for themselves.

1. The learner asks another adult to participate using an email or phone
   invitation. Do not process a reference clip before acceptance.
2. The invited speaker creates their own account and confirms they are at least
   18.
3. Present a standalone release—not a clause buried in general terms—covering:
   - synthetic cloning and generated novel speech;
   - the exact TransVoice coaching purpose and bounded text classes;
   - commercial use, territories and term;
   - raw audio, conditioning state/embedding, output cache, processors and
     international transfers;
   - inference-only use versus any training/fine-tuning;
   - attribution or pseudonym;
   - withdrawal, deletion, backups and wind-down.
4. The speaker signs electronically and records a randomized, app-authored
   consent/reference phrase in a live session.
5. Log a minimal consent receipt: agreement version/hash, account, time, sample
   hash, verification method, permitted scope and current withdrawal state.
6. Give the speaker a revocable share token. In route C, learner and invited-
   speaker clients never receive master recordings, embeddings, conditioning
   assets or weights; personal/invited conditioning remains server-side.
7. Revocation first disables new synthesis, then deletes the raw recording,
   derived conditioning state, caches, processors' copies and backups on a
   documented schedule.

A randomized phrase makes replay harder but is not identity or chain-of-title
proof. Real-time voice cloning can spoof voice-only checks. Treat this as
risk-based enrollment: a low-risk own-voice tier can combine fresh randomized
phrases, account age, device/session continuity, duplicate/repeat-enrollment
detection and throttling; invited-speaker or anomalous cases escalate to manual
review and a stronger counsel-approved verification tier. Pre-register
accept/reject/escalate thresholds, log errors and provide appeal. Do not collect
government ID and face biometrics by default; that creates a larger
sensitive-data problem.

Treat reusable speaker conditioning as highly sensitive even where a statute's
technical definition of “voiceprint” or biometric data is uncertain. If
TransVoice compares consent and reference recordings to verify the same person,
that verification step is more clearly biometric than generation-only
conditioning and needs its own consent and assessment.

Commercial systems already use this stronger pattern:

- Microsoft's current [Custom Neural Voice rules](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/limited-access)
  require explicit written voice-talent permission, a recorded acknowledgement,
  approved use cases, synthetic disclosure and a feedback channel.
- Google's [Chirp 3 Instant Custom Voice](https://docs.cloud.google.com/text-to-speech/docs/chirp3-instant-custom-voice)
  requires a same-speaker consent recording and reference recording.
- ElevenLabs permits another person's professional clone only when that person
  creates, verifies and shares it through their own account; see its
  [voice-cloning guidance](https://elevenlabs.io/docs/help-center/product/voice-customization/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice).

These policies are not law, but they are a useful current safety benchmark.

## Preset performer agreement: minimum deal points

Use an entertainment/IP lawyer and a bespoke synthetic-voice deal, not a
generic voiceover release.

The agreement should address:

1. **Identity and capacity:** adult status, legal identity, agent/union or
   exclusivity conflicts, independent advice, and a conspicuous separate AI
   signature.
2. **Source assets:** exact sessions, cleared scripts, improvisations and
   masters; assignments or sufficiently broad licences from performer,
   scriptwriter, producer and engineer.
3. **Synthetic operations:** recording, editing, segmentation, transcription,
   embeddings, voiceprints, model/adaptor creation, training, fine-tuning,
   quantization, distillation, cloning, evaluation and generation.
4. **Novel speech:** an explicit acknowledgement that TransVoice will create
   words, sentences, emotion and delivery the actor did not perform.
5. **Purpose:** MTF voice-training/tutor use only. Do not use “all purposes in
   perpetuity.”
6. **Text boundary:** TransVoice-authored coaching text at launch. Arbitrary
   user text requires a later, separately approved expansion.
7. **Delivery:** server inference and, only if separately negotiated, future
   end-user distribution of performer-specific on-device weights or
   conditioning assets, including extraction/reverse-engineering risk, expiry,
   updates and installed-app wind-down; also cover streaming, caching, QA,
   store demos and narrowly defined marketing samples.
8. **Sublicensing:** only the processors, contractors, stores and end users
   necessary to operate the app; no standalone resale, extraction,
   third-party training or impersonation.
9. **Name and endorsement:** separate opt-in for real name, biography, likeness,
   marketing or endorsement. Prefer a neutral preset label.
10. **Sensitive implication:** no suggestion that the actor is transgender,
    medically transitioning, a patient or clinician unless separately and
    explicitly authorised.
11. **Compensation:** session and model-creation fees, renewal or
    royalty/residual structure, reporting, audit and union/award compliance.
12. **Term, territory and exclusivity:** a fixed renewable term is safer than a
    perpetual global buyout; keep exclusivity narrow and compensated.
13. **Moral and performer rights:** country-specific treatment and specific
    consents for identified present/future acts.
14. **Approvals:** actor approval of the baseline voice and materially new
    language, accent, emotion or direction, without requiring approval of every
    ordinary coach line.
15. **Privacy:** controller/processor roles, data classes, legal bases,
    retention, transfers, security and actor rights.
16. **Security:** encryption, least privilege, server-side performer assets by
    default, extraction testing, breach notice, logs and synthetic marking. A
    public actor-specific model is forbidden unless item 7 expressly permits
    distribution and both performer and product owner accept the residual
    extraction risk.
17. **Expiry and withdrawal:** stop-new-generation date, installed-app and cache
    handling, store wind-down, backups, model/embedding deletion and
    certification.
18. **Successors:** death/incapacity, acquisition and assignment only when the
    successor assumes all obligations.
19. **Warranties and remedies:** authority, non-conflict, reciprocal warranties,
    defence/indemnity allocation, injunction/takedown and suitable insurance.
20. **Disputes:** law, venue, notices, escalation and emergency suspension.

If using union talent, the current agreement/rider for the relevant union and
territory must be reviewed. In Australia, counsel should start with current
[MEAA resources](https://www.meaa.org/Public/Contents/Resources.aspx), including
the voiceover contract and applicable AI material—not simply copy a US form.

## Jurisdiction map

### Australia

The main planning rules are:

- The recording and spoken material can carry separate copyright. Under
  [Copyright Act 1968 §113B](https://www.legislation.gov.au/C1968A00063/latest/text),
  a performer licence or permission is deemed where purpose-specific recording
  consent exists and use conforms to its terms; that does not itself resolve
  synthetic generation or other owners' rights.
- Australia has no single broad publicity right, but passing off and Australian
  Consumer Law can address false affiliation or endorsement. The
  [ACCC](https://www.accc.gov.au/consumers/advertising-and-promotions/false-or-misleading-claims)
  states that businesses must not make false or misleading claims.
- OAIC guidance treats voice as biometric information when scanned for
  identification or automated verification and generally requires consent
  where the Privacy Act applies. See
  [OAIC biometric scanning](https://www.oaic.gov.au/privacy/your-privacy-rights/surveillance-and-monitoring/biometric-scanning).
- OAIC's [AI privacy guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/guidance-on-privacy-and-the-use-of-commercially-available-ai-products)
  says sensitive-information consent must be informed, current and specific,
  not merely a line in a privacy policy, and recommends a Privacy Impact
  Assessment.
- A statutory serious-invasion-of-privacy tort has applied since 10 June 2025
  and extends beyond APP entities in some circumstances; see the
  [OAIC summary](https://www.oaic.gov.au/privacy/your-privacy-rights/more-privacy-rights/statutory-tort-for-serious-invasions-of-privacy).

The small-business exemption should not be assumed. OAIC says health-service
providers holding health information can be covered regardless of turnover.
Whether gender-affirming voice coaching is a health service—and how marketing
and feature claims affect that answer—is a priority question for Australian
counsel.

### United States

There is no comprehensive enacted federal digital-replica law as of this
research date. Existing federal copyright, false-endorsement and consumer law
coexist with state publicity, digital-replica and biometric laws.

Examples of the patchwork:

- Current [California Civil Code §3344](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=3344.)
  creates liability for knowing commercial use of another person's voice
  without prior consent, subject to exceptions.
- Tennessee's [ELVIS Act](https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=HB2091&GA=113)
  expressly protects voice and addresses AI-enabled replication.
- New York's [Civil Rights Law §50](https://www.nysenate.gov/legislation/laws/CVR/50)
  and [§51](https://www.nysenate.gov/legislation/laws/CVR/51) address certain
  commercial persona uses, while
  [General Obligations Law §5-302](https://www.nysenate.gov/legislation/laws/GOB/5-302)
  adds performer digital-replica contract restrictions.
- Illinois BIPA expressly names a “voiceprint,” requires written notice,
  purpose/term disclosure and release when it applies, and requires a public
  retention/destruction policy. Raw audio is not automatically a voiceprint;
  whether a generation-only reusable representation qualifies is fact-specific.
  See current [BIPA §10 definitions](https://my.ilga.gov/legislation/ilcs/fulltext?DocName=074000140K10)
  and [§15 duties](https://my.ilga.gov/legislation/ilcs/fulltext?DocName=074000140K15).
- Washington's biometric statute narrowly ties “voiceprint” to automatic
  measurement used to identify a specific person and excludes ordinary audio
  and data generated from it. See
  [RCW 19.375](https://app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true).
  That nuance is why the report does not claim every clone embedding is
  automatically a statutory voiceprint.

Washington deserves a separate launch review because its health-data and
personality laws can intersect with gender-affirming services. A conservative
pilot should be Australia-only and intentionally disable other store
territories until counsel clears them.

Before any US release, determine whether the
[FTC Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-business),
FTC Act health/privacy representations, and each enabled state's consumer-
health law apply. “Wellness” branding does not itself settle those questions.

### EU/EEA

Under the [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679),
voice recordings and identifiable voice representations are personal data.
Biometric data becomes Article 9 special-category data when processed for the
purpose of uniquely identifying a person. The TransVoice context may also
reveal gender identity or trans status; that is sensitive personal data but is
not by itself a GDPR Article 9 category. User content or product framing may
separately reveal health data. Treat sexual orientation as special-category
data only when it is separately collected or deliberately inferred. Use
direct, demonstrable consent for the optional cloning pilot, minimise data,
provide erasure and withdrawal, map processors/transfers and perform a DPIA.

The European Data Protection Board's
[voice-assistant guidelines](https://www.edpb.europa.eu/system/files/documents/2021-07/edpb_guidelines_202102_on_vva_v2.0_adopted_en.pdf)
warn about background voices, indefinite retention and secondary model
training; they say voice services are very likely to require a DPIA and should
delete request data when no valid reason remains.

Article 50 of the EU AI Act applies from **2 August 2026**. The Commission's
[FAQ updated 24 July 2026](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
states that:

- generative systems producing synthetic audio must apply effective, reliable,
  interoperable machine-readable marking;
- people must be informed when interacting with AI unless it is obvious;
- deployers of qualifying deepfake audio need a clear human-perceivable
  disclosure; and
- the rule can apply where output is used in the EU.

Build marking and understandable disclosure now instead of treating EU
transparency as a later localization. Every route can say “AI-generated
voice.” B-H may add “based on a performer who licensed this use.” B-S should
say “designed synthetic voice; not intended to represent a real person.” Do not
make a generic permission claim for B-S. The FAQ's narrow 2 December 2026
transition for Article 50(2) marking on systems already placed on the market
before 2 August does not excuse a later new TransVoice launch.

### United Kingdom

The UK has no single general digital-replica/personality right. The government's
[March 2026 copyright-and-AI report](https://www.gov.uk/government/publications/report-and-impact-assessment-on-copyright-and-artificial-intelligence/report-on-copyright-and-artificial-intelligence)
describes the gaps and possible reform. Source recording/script copyright,
performer rights, passing off, data protection, contract and misleading
endorsement therefore remain important. The government's
[performers' rights guidance](https://www.gov.uk/government/publications/performers-rights/performers-rights)
confirms that performers, including voiceover artists, have rights separate
from copyright.

The ICO explains that an ordinary voice recording can be personal data without
automatically being biometric data; specific technical processing for unique
identification changes the analysis. See the
[ICO biometric-recognition guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/biometric-recognition/).

## App-store gates

### Apple

Current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
require, among other things:

- privacy disclosures, minimisation, retention/deletion controls and in-app
  account deletion where accounts exist;
- permission before using or transmitting personal data and explicit
  disclosure/permission before sharing it with third-party AI;
- ownership or licensing of content and “other relevant rights”;
- authorization for third-party service/media use;
- filtering/reporting/blocking/contact controls where the app includes UGC or
  social interaction;
- careful claims where functionality could be treated as health or medical.

Apple does not publish a blanket “all voice cloning is banned” rule. That is not
clearance; the privacy, rights, deception, recording and applicable-law
provisions remain the review gate.

### Google Play

Google explicitly says its
[AI-generated-content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en)
covers apps that create voice or video recordings of real people using AI.
Generative-AI apps must prevent restricted/deceptive uses and provide an
in-app report/flag mechanism.

Google's [Data Safety rules](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
classify voice recordings as “Audio files” and require accurate disclosure when
the app transmits them off-device, including to SDKs or processors.

A private reference available only to its user may fall outside Google's formal
UGC definition, which requires access by at least a subset of other users. That
does not remove AI reporting, privacy, IP, impersonation or data-safety duties.
If voices or outputs become shareable, the complete
[UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB)
applies.

The reporting path does not need to become a third persistent button on the
Coach screen. It can live in Account/Settings and on the voice-detail screen,
preserving the current Start/End surface.

## Current TransVoice technical reality

### The 1B project and VoxCPM2 are separate

The active `finetune-1b` work is a face-off between MiniCPM5-1B and
Qwen3-1.7B for the **coach language model**. Its run plan reserves GPU3 for the
live VoxCPM TTS service. A quantized coach passing the phone gate therefore says
nothing about whether clone-capable TTS also fits.

The app currently configures `openbmb/VoxCPM2`, and the primary standalone
Coach path sends the selected reference to a separate TTS service, caches
reference features and fails closed when that target cannot be resolved.
Turning the reference set into a closed catalogue reduces provenance, storage
and enrollment work, but the same large synthesis model still runs for every
utterance.

**Preset voices do not make VoxCPM2 small.**

### P0 current-boundary finding: the UI is bounded; the server is not

The present Coach interface speaks lesson text, but that is not yet a
server-authoritative public safety boundary:

- guarded `POST /voice/speech/generate` accepts an authorized client's
  `targetText`/`text` (up to 700 characters);
- the legacy registrar exposes `POST /voice/tts` (up to 2,000 caller-supplied
  characters) and continues with a default voice when a requested reference
  cannot be resolved;
- `POST /voice/presets/test` accepts caller text (up to 500 characters); and
- the legacy `/voice/upload-reference` route and the active
  `/voice/presets/reference/save` preset-creation route remain registered.

The standalone route guard establishes network/admin trust, not that the text
was authored by the server for that user's live lesson. Whether every legacy
route is Internet-reachable depends on deployment and is not proved here; all
were live in the inspected local gateway. For a public build, `TXT-01` must
make the client request a one-use server-issued utterance/turn ID. The server
must resolve the already-sanitized text, user, session, authorized preset and
expiry itself. Issuance-side tests must also reject prohibited payment,
emergency, political, impersonation, harassment and third-party-message text.
Modified/replayed text, direct calls, insecure direct-object references, stale
sessions, voice switching and unsigned client content must fail before any TTS
dispatch. Remove or internal-disable every upload/preset-creation route,
including the four named above, and deny stale clients. An unresolved target
must return failure with zero synthesis, never a default voice.

### VoxCPM2 is now edge-capable, but not phone-proven

The current official repository reports:

- 2B parameters;
- about 8 GB PyTorch VRAM;
- Apache-2.0 code and weights;
- 30 languages, voice design and cloning;
- an on-device/edge GGUF route through
  [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni).

The recommended GGUF pair is approximately 3.3 GB:

- Q8 BaseLM: about 1.6 GB;
- F16 acoustic stack: about 1.7 GB.

See the [GGUF model card](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF).
The upstream-reported edge benchmark is roughly RTF 1.76 on an Apple M4 Pro
using Metal, and the runtime documents desktop platforms rather than a released
Android/iOS integration with representative phone measurements. It is a valid
high-end-device experiment, not public-MVP evidence.

The model's license also does not settle dataset provenance. In
[VoxCPM issue #238](https://github.com/OpenBMB/VoxCPM/issues/238), a contributor
said the 2m+ hour dataset details were withheld as trade secrets, assessed
commercial use under Chinese law, disclaimed legal advice, and placed
target-market compliance and reference authorization on the deployer. Before
worldwide commercial use, get a model/data provenance opinion and insurer
acceptance or choose a vendor/model willing to warrant and defend its rights
chain.

### Technical candidates worth testing

| Candidate | Capability and approximate package | Evidence gap | Role |
|---|---|---|---|
| Current VoxCPM2 server | Highest continuity; clone + design; ~8 GB VRAM | Capacity, first-audio latency and public operations | Public preset beta |
| VoxCPM2 GGUF | Clone + design; ~3.3 GB Q8/F16 pair | No representative phone proof; large beside coach | High-end-device lab |
| Pocket TTS int8 | 100M clone-capable model; ~98 MB compressed [sherpa archive](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html) | Mac benchmark, not production phone/quality proof; consent-gated license | Best small-clone spike |
| KittenTTS Nano int8 | Fixed voices; 15M and ~25 MB ONNX | Mobile SDK/performance and built-in voice provenance | Best tiny fixed-preset spike |
| Fixed VITS/ONNX | Fixed voice; footprint depends on architecture | Training cost, quality, and extractable distributed asset; actor-specific use needs express contract | Best offline lane for B-S; B-H only by separate performer permission |
| Apple/Android system TTS | No bundled model | Voice availability/identity varies by OS and engine | Fallback only |
| Azure/Google/ElevenLabs clone | No phone model | Cost, network, privacy, vendor approval and dependency | Conditional operational alternative |

Primary technical sources:

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) and its
  [model terms](https://huggingface.co/kyutai/pocket-tts)
- [KittenTTS](https://github.com/KittenML/KittenTTS) and
  [int8 model](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [Apple AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer)
- [Android TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech)

Every third-party model still needs its own licence, built-in-voice provenance,
training-data and redistribution dossier. “Apache/MIT” on code is not proof
that a bundled identifiable persona is cleared.

## Data and abuse architecture

### Data rules

- Treat raw voice, transcript, conditioning state/embedding and consent evidence
  as separate data classes.
- Encrypt them at rest and in transit; keep actor master recordings off phones.
- Do not use user or invited-speaker recordings to train shared weights by
  default. Shared-weight training makes individual deletion/unlearning much
  harder.
- Delete raw personal-clone audio after enrollment and QC if a tested stable
  derived representation is sufficient. If not, state and enforce the actual
  retention need.
- Delete all derived states and caches on withdrawal; propagate deletion to
  processors and bounded backups.
- Use short output-cache retention and no downloadable archive.
- Separate consent to operate the requested clone from an optional, unbundled
  consent to research or improve models.
- Conduct an Australian PIA and, before EU service, a DPIA. Maintain a processor
  map, transfer mechanism, access logs, incident plan and deletion tests.

### Abuse controls

- Stages 1 and 2 are **18+ only**. Enforce the declared target audience in
  store metadata and account eligibility. Serving minors is a later product
  decision requiring age assurance, parental authority where applicable,
  child-data minimisation, safeguarding, store Families declarations and
  jurisdiction-specific counsel review.
- Live subject-led enrollment; no URLs and no ripped/public-source file import.
- Block public figures, politicians, character names, deceased people and
  minors.
- After `TXT-01`, lesson-bounded, server-issued text only. This is a required
  future state, not a description of the current gateway.
- Block payment requests, emergency instructions, political endorsements,
  fundraising, sexual content, threats, third-party messages, defamatory
  statements and real-person endorsements.
- No public synthesis API, export, sharing, calls or messages.
- Rate-limit enrollment and synthesis; flag repeated failures and suspicious
  device/account patterns.
- Persistent synthetic marking plus a clear human-facing disclosure.
- In-app generated-output report control and a public voice-owner complaint
  form.
- Immediate per-voice quarantine/takedown switch, investigation log, appeal and
  repeat-abuser controls.
- Australia-only access must be enforced at both store and service/account
  layers. Define Australian-resident eligibility, travel/VPN handling,
  processor/data locations and privacy-minimised jurisdiction logs; store
  territory settings alone are insufficient.

A genuinely server-bounded coach would be a major risk reducer because users
could not make the voice deliver scams, political messages or arbitrary
defamatory lines. The current gateway does not yet establish that property.
Even after `TXT-01`, the boundary does not cure an unlicensed source recording,
lack of speaker consent, privacy, deletion, false endorsement or app-store
rights problems.

## Staged release plan

### Stage 0 — internal research now

- Obtain the `DEC-01` owner ruling and draft the public-product contract that
  supersedes the current
  [uploaded-reference contract](../../docs/VOICE_COACH_MEMORY_CONTRACT.md) for
  public mode.
- Keep Aster and every reference lacking a complete rights ledger quarantined
  under `AST-01`.
- Create six B-S candidates using internal acoustic descriptors; freeze each
  candidate identity and run `SIM-01`.
- Recruit two adult actors only after `HVOICE-01A` pre-recording authorization
  and counsel-approved synthetic-voice terms.
- Build a rights ledger and per-voice kill switch before recording.
- Design and prove `TXT-01` and `MIG-01`: server-issued utterances only, no
  public upload path, and fail-closed reference resolution.
- Run KittenTTS, Pocket TTS and VoxCPM2 GGUF device spikes independently of the
  public app.

### Stage 1 — Australia-only closed mobile pilot

- Recommended planning envelope: 25–50 Australian-resident adults for four
  weeks. The product owner may change that envelope in `DEC-01`, before
  recruitment—not after results are seen.
- Three to six closed-catalogue voices.
- Server-side coach and VoxCPM2.
- Exact selected voice or fail closed; never silently substitute system TTS.
- Fixed, server-owned catalogue masters with stable target bindings. Remove the
  learner upload UI; reject old upload/enrollment calls server-side; quarantine
  existing uncleared presets.
- `TXT-01` complete: no arbitrary synthesis text, including from an otherwise
  authorized client.
- Privacy, AI, mic and synthetic-voice disclosures.
- In-app report plus external rights-holder complaint path.
- Adult-only TestFlight/Play closed testing, other store territories disabled,
  and Australian eligibility enforced at the service/account layer.
- Exit only when the `PILOT-01` thresholds in the register below pass; otherwise
  stop enrollment, quarantine the affected voice/path and return to Stage 0.

### Stage 2 — adult public preset release

Open only after:

- `PILOT-01` passes its predeclared voice-acceptance and safety thresholds;
- Australian entertainment/IP/privacy advice;
- every applicable B-H or B-S rights/provenance dossier;
- PIA, deletion and incident-response tests;
- Apple privacy labels and Google Data Safety/health declarations;
- synthetic marking;
- capacity, queue, latency, cost and abuse-response gates; and
- an express adult-only target-audience decision. Minors remain disabled until
  the separate `CHILD-01` package is approved.

### Stage 3 — consenting-speaker beta

Add only after `CLONE-01` passes the subject-led invitation, direct release,
risk verification, withdrawal, deletion, processor and jurisdiction tests.
Start with adult own-voice enrollment, then a very small invited-adult cohort.

### Stage 4 — offline TTS

Do not make this a prerequisite for having a phone app. Promote a model only
after actual-device receipts for:

- package and installed size;
- cold/warm load and first-audio latency;
- peak memory and OS memory pressure;
- sustained and p95 RTF;
- coach alone, TTS alone and both together;
- thermal throttling and battery drain;
- intelligibility, coaching prosody and human-rated target identity;
- low/mid/high Android and several iPhone generations.

The cleanest offline lane is a B-S or platform/system voice with cleared
redistribution. Route C personal/invited conditioning remains server-side under
this recommendation. Keep B-H commissioned-performer conditioning server-side
unless the performer agreement expressly authorizes public distribution of the
model/conditioning asset, extraction and reverse-engineering risk, updates,
expiry and installed-app wind-down. VoxCPM2 GGUF remains the continuity
experiment for high-end hardware.

## Rollout control register

Paths below are required future evidence locations, to be created only after
owner approval. Role labels may be held by the same person in a small team, but
the approval responsibility must remain explicit.

| Gate | Stage / entry trigger | Accountable owner | Deliverable and evidence path | Pass/fail threshold | Jurisdiction / approver / exit |
|---|---|---|---|---|---|
| `DEC-01` | Before Stage 0 public-lane work or pilot recruitment | Product owner | Signed option/product-contract ruling · `studio/public-mobile/decisions/DEC-01.md` | All four approval items at the top are expressly approved, rejected or amended; budget, pilot envelope and voice-acceptance metric recorded before recruitment | All / product owner / authorize Stage 0 only |
| `AST-01` | Now; before any existing reference use | Product owner + rights counsel | Provenance ledger for each legacy asset · `studio/public-mobile/rights/legacy/<asset-id>.md` | Source URL/identity/capture/hash/licence/permission complete and counsel-cleared, or asset remains quarantined with an evidence-hold/deletion date | Enabled market / counsel / clear or delete |
| `HVOICE-01A` | Before any B-H recording | Rights lead | Identity/capacity/conflict check, approved scripts/session plan, compensation and signed synthetic-recording/model authorization · `studio/public-mobile/rights/human/<voice-id>-authorization.md` | 100% pre-recording fields and signatures; no unresolved red condition | Enabled market / counsel + product / record or stop |
| `HVOICE-01B` | After recording, before any B-H release | Rights lead | Master/script/model, term/territory, processor, withdrawal, approval and marketing dossier · `studio/public-mobile/rights/human/<voice-id>-release.md` | Performer baseline approval and 100% release fields complete; no unresolved red condition | Enabled market / counsel + product / admit or reject voice |
| `SVOICE-01` | Before a B-S voice release | Voice QA lead | Prompt/seed/model/source dossier, frozen identity, `SIM-01`, marking and complaint plan · `studio/public-mobile/rights/synthetic/<voice-id>.md` | `SIM-01` passes; exact-identity regression passes; no intended human reference or unresolved resemblance | Enabled market / rights counsel + product / admit or quarantine |
| `MODEL-01` | Before Stage 1 or any inference for a non-team user | Technical lead | Code/weight/built-in-voice/training-data/redistribution dossier · `studio/public-mobile/rights/models/<model-id>.md` | Counsel and insurer accept the documented residuals, or vendor contract warrants/defends the rights chain | Enabled market / counsel + insurer / deploy or replace |
| `TXT-01` | Before Stage 1 | Backend/security lead | Route map and negative/issuance-test receipt · `studio/public-mobile/verify/TXT-01.md` | Modified/replayed/unsigned text, direct calls, IDOR, stale sessions and voice swaps all fail with **zero upstream TTS calls**; server issuance rejects the prohibited content classes in Abuse controls; only one-use server-issued utterance IDs synthesize | Public build / security + product / pilot or block |
| `MIG-01` | Before Stage 1 | Product + backend leads | Public-mode contract/UI/server migration receipt · `studio/public-mobile/verify/MIG-01.md` | Upload UI absent; `/voice/tts`, `/voice/upload-reference`, `/voice/presets/test`, `/voice/presets/reference/save` and every other preset-creation route absent or internal-denied; stale enrollment calls denied; existing uncleared presets quarantined; no default substitution | Public build / security + product / pilot or rollback |
| `DATA-01` | Before Stage 1 | Privacy lead | Australian Privacy Impact Assessment (PIA), processor map and deletion/breach tests · `studio/public-mobile/privacy/DATA-01.md` | 100% test records deleted or placed in documented bounded legal hold across raw, derived, cache, processor and backup layers within counsel-approved schedules | Australia / privacy counsel / pilot or block |
| `AGE-GEO-01` | Before each release | Release owner | Adult and Australian eligibility/control test · `studio/public-mobile/verify/AGE-GEO-01.md` | Store + account controls declare/enforce 18+; non-Australian eligibility fails at service layer; travel/VPN exception and minimised logs documented | Australia / privacy counsel + product / open or block |
| `STORE-01` | Before each store submission | Release owner | Apple/Google disclosures, synthetic marking, in-app report and complaint test · `studio/public-mobile/store/STORE-01.md` | Declarations match packet captures/data flow; report works; credible rights complaint acknowledged within 1 business day and voice quarantinable within 4 hours | Australia / release owner + counsel / submit or block |
| `OPS-01` | Before and during Stage 1 | Operations lead | Load/cost/failure receipt · `studio/public-mobile/verify/OPS-01.md` | Recommended defaults: p95 first audio ≤3 s; successful synthesis ≥99%; zero wrong/default voices; 2× forecast peak without unsafe queue growth; per-session cost within the owner-approved budget | Pilot / product + operations / continue or stop |
| `PILOT-01` | End of Stage 1 | Product owner | Four-week pilot decision · `studio/public-mobile/decisions/PILOT-01.md` | 25–50 eligible adults unless `DEC-01` says otherwise; all earlier gates stay green; zero unresolved critical/high rights or safety incidents; predeclared voice-acceptance target met | Australia / product + counsel / Stage 2, extend, or stop |
| `CLONE-01` | Before Stage 3 | Product + privacy leads | Subject-led contract, verification, revocation/deletion and abuse evidence · `studio/public-mobile/verify/CLONE-01.md` | Own/invited adult only; direct release; predeclared risk thresholds; repeated-spoof/withdrawal/deletion tests pass 100%; no public-figure/minor/source-URL path | Separately cleared markets / counsel + security / beta or block |
| `CHILD-01` | Only if minors are proposed | Child-safety/privacy lead | Age assurance, parental authority, minimisation, safeguarding, store declarations and country advice · `studio/public-mobile/privacy/CHILD-01.md` | No minor access until every applicable requirement and test is approved; a partial package is a fail | Each market / specialist counsel + product / enable or retain 18+ |
| `DEVICE-01` | Before any Stage 4 model | Mobile lead | Actual-device matrix receipt · `studio/public-mobile/verify/DEVICE-01.md` | Product owner pre-registers installed-size, memory, latency/RTF, thermal, battery, identity and quality thresholds before testing; all pass on the supported matrix | Supported devices / product + voice QA / ship or retain server |

## Hard launch gates

Do not claim public readiness until the control register proves every
applicable gate:

- [ ] `DEC-01`, `AST-01`, `MODEL-01`, `TXT-01`, `MIG-01`, `DATA-01`,
      `AGE-GEO-01`, `STORE-01`, `OPS-01` and `PILOT-01` pass before Stage 2.
- [ ] Every B-H voice passes `HVOICE-01A` before recording and `HVOICE-01B`
      before release; every B-S voice passes `SVOICE-01` and `SIM-01`. A human
      release is not invented for a no-reference B-S voice, and a resemblance
      screen is not substituted for a B-H release.
- [ ] No admitted voice is intentionally celebrity-, character-, public-
      figure-, deceased- or minor-derived; resemblance complaints trigger
      quarantine and re-screening.
- [ ] Exact target selection fails closed with zero default substitution.
- [ ] The public build exposes no upload, free-text synthesis, export, share,
      call or message path, and its internal TTS accepts only bound one-use
      server-issued utterances.
- [ ] EU/UK DPIA, transfer/controller work and country-specific Article 50
      implementation pass before those territories open.
- [ ] Launch counsel signs off on the actual enabled countries—not an abstract
      global product.

## Questions to hand counsel

1. Is TransVoice an Australian health-service provider or otherwise an APP
   entity despite turnover?
2. Does its generation-only conditioning state count as biometric sensitive
   information in each enabled jurisdiction? How does same-speaker verification
   change that?
3. What exact Australian copyright, performer, moral-right and consumer-law
   language belongs in the actor and invited-speaker agreements?
4. How should the contracts satisfy California and New York performer digital
   replica rules?
5. Does TransVoice's MTF focus bring Washington My Health My Data into scope,
   and should Washington remain disabled initially?
6. Which EU Article 50 roles does TransVoice occupy, and which audio marking
   implementation is sufficient?
7. Which retention, backup, legal-hold and processor-deletion timelines are
   supportable?
8. Which wellness, health, therapeutic or medical claims should be removed,
   qualified or substantiated?
9. Is VoxCPM2's undisclosed training-corpus position acceptable for commercial
   use in each target market, and will the insurer cover it?
10. Which jurisdiction attaches based on the speaker, learner, company, store
    territory, processor and output location?
11. Before any US release, do the FTC Health Breach Notification Rule, FTC Act
    health/privacy representations or state consumer-health statutes apply?
12. If the owner later proposes minors, which age-assurance, parental-authority,
    child-data, safeguarding and store-Families requirements apply?

## Short glossary

- **APP entity:** an organization covered by Australia's Privacy Act and
  Australian Privacy Principles.
- **PIA / DPIA:** Privacy Impact Assessment / Data Protection Impact Assessment.
- **RTF:** real-time factor; below 1 means generation is faster than playback.
- **p95:** 95th-percentile result; 95% of measured requests are at or below it.
- **SLA:** a committed response-time target.
- **UGC:** user-generated content.
- **GGUF / ONNX:** model packaging/runtime formats, not rights clearances.
- **VITS:** a family of neural text-to-speech architectures.

## Recommendation summary

The two original options are not equally launchable:

- **A: arbitrary goal-voice upload** is a no-go for public release.
- **B-H/B-S: prepared catalogue voices** are workable when “prepared” means
  commissioned or designed without an intended real-person target,
  rights/provenance-ledgered, stable, screened, disclosed, server-bounded and
  terminable—not downloaded from public media or assumed safe because a model
  is open source.
- **C: subject-controlled adult cloning** remains a later, separately gated
  option.
- **D: the private current baseline** can support research but is not a public
  rights or server-boundary position.

The recommended rollout is B first, possibly C later, with server TTS now and
independent on-device experiments. It can preserve the exact-voice promise only
after a B-S candidate is frozen into a stable identity and `TXT-01`/`MIG-01`
make the server—not the UI—the authority. The product owner must ratify that
course; this memo does not do so.
