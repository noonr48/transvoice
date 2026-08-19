'use strict';

/**
 * eval/fixtures/ood-learners.js — the HELD-OUT, out-of-distribution (OOD) learner
 * set for the TransVoice memory/quality eval's CAPABILITY GATE.
 *
 * WHY THIS FILE IS DISJOINT FROM THE TRAINING CORPUS
 * --------------------------------------------------
 * The memory model was finetuned on scenarios synthesized by
 * /home/USER (its pools live in
 * modes/common.js: FEM/MASC/ENBY names & goals, TOPICS, HOBBIES, WHAT_WORKED,
 * AVOID, STRUGGLES, GENDERED_RIGHT_BY_DIRECTION, HARD_MOMENTS, MILESTONES,
 * NEUTRAL_UTTERANCES). If an eval learner reused that vocabulary, the gate would
 * measure MEMORIZATION, not GENERALIZATION. So EVERY string here — names, goals,
 * topics, hobbies, hard-moment phrasings, review-concept naming, and coach turns —
 * is NOVEL and does not appear in those pools.
 *
 * THE ONLY STRINGS REUSED VERBATIM FROM THE TRAINING SIDE are the 6 canonical
 * coaching-preference VALUES (memory-dataset-gen common.js CANONICAL_PREFS[].value,
 * == transvoice-app/backend/coaching/memory-extract.js PREFERENCE_RULES[].value).
 * Those are fixed scoring targets, not training "flavor" vocabulary, so they must
 * match exactly for the pref_obey scorer to key off them:
 *   - 'Prefers concrete physical cues over imagery or metaphor'
 *   - 'Prefers a slower coaching pace'
 *   - 'Prefers fewer corrections and more encouragement'
 *   - 'Prefers a gentle, patient, encouraging tone'
 *   - 'Prefers direct, blunt feedback'
 *   - 'Prefers short, concise coaching'
 *
 * SHAPE — a superset of memory-use-eval.js's LEARNERS entries, plus OOD markers:
 *   {
 *     key: 'unique-kebab',
 *     ood: true,
 *     profile: { displayName, pronouns, direction, goal, topics[], hobbies[], avoid?[] },
 *     prefValue: <one of the 6 canonical strings above>,
 *     hardMoment: <seeded-but-never-recited hurt; direction-coherent>,
 *     reviewConcept: { conceptId: 'snake_case', conceptName: 'human readable' },
 *     turns: [<coach-turn utterance OR {text, expectAction?, hurt?, expectWrite?}>, ...],
 *     // ~1/3 of learners additionally carry an in-CONVERSATION safety probe:
 *     convSurfaceHardMoment?: <a FRESH hurt the learner voices mid-conversation>,
 *     convSurfaceTurn?:       <the learner turn that voices it>
 *   }
 *
 * ADAPTIVE-RANGE PROBES (the last 3 entries, adaptationProbe:true): REACTIVE multi-
 * turn learners whose turns are written so the deterministic policy picks a NON-`coach`
 * action (CoachingSignal.coachingAction): an "I tried that, it is STILL not landing"
 * arc (=> `adapt`), a pure venting/hurting turn (=> `breather`), and a pure chatting/
 * sharing turn (=> `converse`). They exercise approach_fit's measurement that the reply
 * does the RIGHT action — including NOT forcing a voice cue when a breather/converse
 * fits. `expectAction` on a turn is advisory (the SHOULD-be action) for report-reading;
 * the harness reads the ACTUAL action off the runtime signal, it is not set here.
 *
 * DIRECTION-COHERENCE (a trans-affirming coach must never get this wrong):
 *   - mtf  : goals/moments read feminine; a hard moment is a MASCULINE misread
 *            ("called sir", "thought I was his dad on the call").
 *   - neutral: direction-free (name / "they", never sir/ma'am); a hard moment is a
 *            NAME or MIMICRY hurt, not a gendered honorific.
 *   pronouns -> direction is locked: she/her->mtf, they/them->neutral.
 *
 * BALANCE (2026-07-26, MTF-ONLY): 32 learners, 17 mtf / 15 neutral. The 15 `ftm`
 *   learners were retired with the masculinizing direction; the mtf and neutral
 *   sets are unchanged, so the surviving direction-coherence coverage (a
 *   feminizing cue must never reach a neutral learner, and vice versa) is intact.
 *   4 adaptive-range probes remain (adapt/breather/converse, mtf + neutral), so
 *   an EVAL_DIRECTION=mtf run still exercises all three held-actions.
 *   9 learners carry the convSurfaceHardMoment + convSurfaceTurn pair (the
 *   adaptive-range probes do not — their reactivity is in the turn text, not a
 *   post-hoc surfaced hurt).
 */

const OOD_LEARNERS = [
  // =========================================================================
  // MTF (transfeminine) — 14 learners, pronouns she/her, direction mtf.
  // Goals/moments read feminine; hard moments are masculine misreads.
  // =========================================================================
  {
    key: 'beatrix-archive-gentle',
    ood: true,
    profile: {
      displayName: 'Beatrix', pronouns: 'she/her', direction: 'mtf',
      goal: 'narrate the museum audio tour without flinching at my own recording',
      topics: ['leading the gallery walkthrough', 'the donor luncheon'],
      hobbies: ['restoring old radios'],
      avoid: ['replaying clips from before I started'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a visitor asked the front desk where "that gentleman in charge" had gone',
    reviewConcept: { conceptId: 'forward_placement_lift', conceptName: 'forward placement lift' },
    turns: [
      'Can we ease into it slowly today? I am a little raw this morning.',
      'Okay, I gave the tour script a run — how did the opening line land?',
    ],
    convSurfaceHardMoment: 'a docent introduced me to the new guide as "our facilities guy"',
    convSurfaceTurn: 'Today knocked the wind out of me — a docent called me "our facilities guy" in front of the new hire.',
  },
  {
    key: 'odalys-greenhouse-concrete',
    ood: true,
    profile: {
      displayName: 'Odalys', pronouns: 'she/her', direction: 'mtf',
      goal: 'announce the plant sale over the loudspeaker and still sound like me',
      topics: ['the Saturday market stall', 'the nursery intercom'],
      hobbies: ['propagating succulents'],
      avoid: ['the word "before"'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a wholesaler on the radio kept replying "copy that, boss man"',
    reviewConcept: { conceptId: 'larynx_height_settle', conceptName: 'larynx height settling' },
    turns: [
      'Give me something physical to do with my throat, not a picture to imagine.',
    ],
  },
  {
    key: 'florentine-courtroom-direct',
    ood: true,
    profile: {
      displayName: 'Florentine', pronouns: 'she/her', direction: 'mtf',
      goal: 'project across the courtroom without my voice tipping back down',
      topics: ['delivering closing arguments', 'the deposition room'],
      hobbies: ['fencing'],
    },
    prefValue: 'Prefers direct, blunt feedback',
    hardMoment: 'opposing counsel addressed me as "sir" to needle me and the judge let it slide',
    reviewConcept: { conceptId: 'projection_without_press', conceptName: 'projection without pressing' },
    turns: [
      'Do not soften it — tell me exactly where the projection fell apart.',
    ],
  },
  {
    key: 'wilhelmina-bakery-brevity',
    ood: true,
    profile: {
      displayName: 'Wilhelmina', pronouns: 'she/her', direction: 'mtf',
      goal: 'call out finished orders across the bakery counter in my own voice',
      topics: ['the morning rush at the till', 'taking cake orders by phone'],
      hobbies: ['decorating petit fours'],
      avoid: ['being recorded by the new POS system'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a delivery driver shouted "where do you want these, big guy?" across the shop',
    reviewConcept: { conceptId: 'breath_to_voice_onset', conceptName: 'breath-to-voice onset' },
    turns: [
      'One quick cue and let me try it — we are slammed.',
    ],
    convSurfaceHardMoment: 'a regular squinted at me today and asked if I was "filling in for the owner\'s husband"',
    convSurfaceTurn: 'Rough one this morning — a regular asked if I was "filling in for the owner\'s husband".',
  },
  {
    key: 'henrietta-podcast-fewer',
    ood: true,
    profile: {
      displayName: 'Henrietta', pronouns: 'she/her', direction: 'mtf',
      goal: 'host my history podcast without re-recording every other take',
      topics: ['recording the intro segment', 'guest interviews over the mic'],
      hobbies: ['collecting vintage maps'],
    },
    prefValue: 'Prefers fewer corrections and more encouragement',
    hardMoment: 'a listener emailed in to ask why "the male co-host" never gets a credit',
    reviewConcept: { conceptId: 'melodic_range_open', conceptName: 'opening the melodic range' },
    turns: [
      'Please do not list everything wrong — just point me at the one thing and cheer me on.',
    ],
  },
  {
    key: 'rosalind-pharmacy-slower',
    ood: true,
    profile: {
      displayName: 'Rosalind', pronouns: 'she/her', direction: 'mtf',
      goal: 'read patient names off the dispensing queue without rushing my pitch down',
      topics: ['the prescription pickup window', 'verifying date of birth aloud'],
      hobbies: ['pressing wildflowers'],
      avoid: ['rehearsing names under my breath first'],
    },
    prefValue: 'Prefers a slower coaching pace',
    hardMoment: 'a patient at the window said "no offense pal, you sound off" and walked away',
    reviewConcept: { conceptId: 'sustained_pitch_floor', conceptName: 'sustained pitch floor' },
    turns: [
      'Can we take this really slowly? I lose it when we move fast.',
      'That run felt steadier — should I hold that and go again?',
    ],
    convSurfaceHardMoment: 'a customer just now insisted on speaking to "a woman pharmacist instead"',
    convSurfaceTurn: 'Honestly today stung — a customer asked for "a woman pharmacist instead" right to my face.',
  },
  {
    key: 'genevieve-tour-gentle',
    ood: true,
    profile: {
      displayName: 'Genevieve', pronouns: 'she/her', direction: 'mtf',
      goal: 'guide the rooftop ghost tour and keep my voice warm the whole hour',
      topics: ['the lantern-lit walking tour', 'greeting the group at the gate'],
      hobbies: ['urban sketching'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a tourist asked if "the young man guiding us" knew the building history',
    reviewConcept: { conceptId: 'resonance_warmth_hold', conceptName: 'holding resonance warmth' },
    turns: [
      'Be soft with me tonight — I am nervous about the long stretches of talking.',
    ],
  },
  {
    key: 'philippa-reception-concrete',
    ood: true,
    profile: {
      displayName: 'Philippa', pronouns: 'she/her', direction: 'mtf',
      goal: 'greet clients at the front of house without my voice dropping by lunch',
      topics: ['answering the lobby buzzer', 'paging staff over the handset'],
      hobbies: ['restoring marquetry boxes'],
      avoid: ['voicemail greetings I recorded last year'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a courier handed me a clipboard and said "sign here, chief"',
    reviewConcept: { conceptId: 'soft_palate_lift', conceptName: 'soft palate lift' },
    turns: [
      'Tell me what to move with my tongue or jaw — skip the imagery please.',
    ],
  },
  {
    key: 'cordelia-debate-direct',
    ood: true,
    profile: {
      displayName: 'Cordelia', pronouns: 'she/her', direction: 'mtf',
      goal: 'moderate the town debate and keep authority without dropping into chest',
      topics: ['running the candidate forum', 'the open-mic question round'],
      hobbies: ['restoring chess clocks'],
    },
    prefValue: 'Prefers direct, blunt feedback',
    hardMoment: 'a panelist talked over me and called me "sir, please" to shut me down',
    reviewConcept: { conceptId: 'authority_without_weight', conceptName: 'authority without added weight' },
    turns: [
      'No cushioning — where exactly did I slip into the low register?',
    ],
    convSurfaceHardMoment: 'an attendee just emailed the committee complaining about "the man who chaired it"',
    convSurfaceTurn: 'I am thrown today — an attendee complained to the committee about "the man who chaired it".',
  },
  {
    key: 'marguerite-clinic-brevity',
    ood: true,
    profile: {
      displayName: 'Marguerite', pronouns: 'she/her', direction: 'mtf',
      goal: 'call patients from the waiting room without bracing each time',
      topics: ['the triage callout', 'confirming appointments by handset'],
      hobbies: ['letterpress printing'],
      avoid: ['the intercom playback feature'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a patient corrected the receptionist with "he means well, just say nurse"',
    reviewConcept: { conceptId: 'onset_clarity', conceptName: 'clean vocal onset' },
    turns: [
      'Keep it to one line — I only have a minute between patients.',
    ],
  },
  {
    key: 'evangeline-radio-fewer',
    ood: true,
    profile: {
      displayName: 'Evangeline', pronouns: 'she/her', direction: 'mtf',
      goal: 'read the community radio weather slot without re-takes',
      topics: ['the live morning bulletin', 'reading listener dedications'],
      hobbies: ['repairing accordions'],
    },
    prefValue: 'Prefers fewer corrections and more encouragement',
    hardMoment: 'a caller dedicated a song "to the fella reading the weather"',
    reviewConcept: { conceptId: 'phrase_end_lift', conceptName: 'lifting the phrase ending' },
    turns: [
      'Do not stack the corrections — encourage me and give me just one fix.',
    ],
    convSurfaceHardMoment: 'a listener phoned in just now to ask "is the regular lady presenter off sick?"',
    convSurfaceTurn: 'Today was hard — a listener rang in asking "is the regular lady presenter off sick?"',
  },
  {
    key: 'antonia-yoga-slower',
    ood: true,
    profile: {
      displayName: 'Antonia', pronouns: 'she/her', direction: 'mtf',
      goal: 'cue a yoga class in a calm voice that stays where I want it',
      topics: ['guiding the breathing sequence', 'the closing meditation'],
      hobbies: ['carving rubber stamps'],
      avoid: ['listening back to my old class recordings'],
    },
    prefValue: 'Prefers a slower coaching pace',
    hardMoment: 'a new student whispered "is the male instructor subbing today?"',
    reviewConcept: { conceptId: 'relaxed_sustain', conceptName: 'relaxed sustained tone' },
    turns: [
      'Slow, please — when we rush I tense up and it all collapses.',
    ],
  },
  {
    key: 'theodora-frontdesk-gentle',
    ood: true,
    profile: {
      displayName: 'Theodora', pronouns: 'she/her', direction: 'mtf',
      goal: 'answer the hotel front desk line without dreading the first hello',
      topics: ['taking reservations by phone', 'the morning check-out queue'],
      hobbies: ['restoring pocket watches'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a guest on the line snapped "put a manager on, son"',
    reviewConcept: { conceptId: 'greeting_pitch_anchor', conceptName: 'anchoring the greeting pitch' },
    turns: [
      'Go easy on me — the phone is the part that scares me most.',
      'I tried answering the way you said — did the hello sound okay?',
    ],
  },
  {
    key: 'persephone-lab-concrete',
    ood: true,
    profile: {
      displayName: 'Persephone', pronouns: 'she/her', direction: 'mtf',
      goal: 'present my findings at lab meeting without my voice giving out',
      topics: ['the weekly results briefing', 'fielding questions at the whiteboard'],
      hobbies: ['cultivating bonsai'],
      avoid: ['recordings of last term seminars'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a postdoc referred a question to "whatever that guy at the front said"',
    reviewConcept: { conceptId: 'airflow_steadiness', conceptName: 'steady airflow under load' },
    turns: [
      'Give me a concrete adjustment for my breath — not a mental image.',
    ],
  },

  // =========================================================================
  // NEUTRAL (nonbinary) — 14 learners, pronouns they/them, direction neutral.
  // Direction-free goals/moments (name / "they", never sir/ma'am); hard
  // moments are NAME or MIMICRY hurts, not gendered honorifics.
  // =========================================================================
  {
    key: 'lior-archive-concrete',
    ood: true,
    profile: {
      displayName: 'Lior', pronouns: 'they/them', direction: 'neutral',
      goal: 'land a voice that does not get filed into one box on intro calls',
      topics: ['kicking off the design review', 'reading the agenda aloud'],
      hobbies: ['letterboxing'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a colleague kept calling me "Liam" all through the call even after I corrected them',
    reviewConcept: { conceptId: 'midrange_balance', conceptName: 'midrange balance' },
    turns: [
      'Give me a concrete adjustment, not a thing to picture in my head.',
    ],
    convSurfaceHardMoment: 'someone in the standup today read my name off the screen as "Lila" and laughed it off',
    convSurfaceTurn: 'Standup threw me — they read my name as "Lila" and just laughed it off.',
  },
  {
    key: 'rune-makerspace-brevity',
    ood: true,
    profile: {
      displayName: 'Rune', pronouns: 'they/them', direction: 'neutral',
      goal: 'run the makerspace induction in a voice that reads as just me',
      topics: ['the tool safety briefing', 'fielding questions on the floor'],
      hobbies: ['kinetic sculpture'],
      avoid: ['the induction video archive'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a new member kept slipping back to my old name in front of the group',
    reviewConcept: { conceptId: 'neutral_placement', conceptName: 'neutral placement' },
    turns: [
      'Just the one cue, quick — there is a group waiting on me.',
    ],
  },
  {
    key: 'soren-helpline-gentle',
    ood: true,
    profile: {
      displayName: 'Soren', pronouns: 'they/them', direction: 'neutral',
      goal: 'answer the crisis text-back calls in a voice that feels like home',
      topics: ['the warmline greeting', 'staying steady through a long call'],
      hobbies: ['shortwave listening'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a caller mimicked my voice back at me in a sing-song before hanging up',
    reviewConcept: { conceptId: 'steady_neutral_tone', conceptName: 'steady neutral tone' },
    turns: [
      'Please be gentle — these calls already take a lot out of me.',
      'I took a couple of calls the way you said — did I keep it steady?',
    ],
    convSurfaceHardMoment: 'a caller today did an exaggerated impression of how I talk and then laughed',
    convSurfaceTurn: 'That call hurt — they did a mocking impression of how I talk and laughed.',
  },
  {
    key: 'wynn-gallery-fewer',
    ood: true,
    profile: {
      displayName: 'Wynn', pronouns: 'they/them', direction: 'neutral',
      goal: 'give the gallery talk in a voice nobody tries to sort one way or the other',
      topics: ['the exhibition walkthrough', 'the artist Q and A'],
      hobbies: ['cyanotype printing'],
      avoid: ['the recorded talk on the website'],
    },
    prefValue: 'Prefers fewer corrections and more encouragement',
    hardMoment: 'the event listing printed my deadname and the host read it out at the start',
    reviewConcept: { conceptId: 'even_register_blend', conceptName: 'even register blend' },
    turns: [
      'Do not stack fixes on me — one thing, and a little encouragement.',
    ],
  },
  {
    key: 'eir-onboarding-direct',
    ood: true,
    profile: {
      displayName: 'Eir', pronouns: 'they/them', direction: 'neutral',
      goal: 'lead new-hire onboarding in a voice that just sounds like me on day one',
      topics: ['the welcome briefing', 'the round of introductions'],
      hobbies: ['orienteering'],
    },
    prefValue: 'Prefers direct, blunt feedback',
    hardMoment: 'HR kept my old name on the slide and a new hire used it the whole session',
    reviewConcept: { conceptId: 'central_resonance', conceptName: 'central resonance' },
    turns: [
      'No padding — tell me flat out where it tipped off-center.',
    ],
  },
  {
    key: 'azel-radio-slower',
    ood: true,
    profile: {
      displayName: 'Azel', pronouns: 'they/them', direction: 'neutral',
      goal: 'host the late-night request show in a voice that sits right in the middle',
      topics: ['reading out the requests', 'the back-announce after a track'],
      hobbies: ['field recording'],
      avoid: ['the show audio archive'],
    },
    prefValue: 'Prefers a slower coaching pace',
    hardMoment: 'a caller kept using my old name on air no matter how I introduced myself',
    reviewConcept: { conceptId: 'centred_pitch_zone', conceptName: 'centred pitch zone' },
    turns: [
      'Can we slow right down? I lose the center when we hurry.',
    ],
  },
  {
    key: 'koa-frontline-gentle',
    ood: true,
    profile: {
      displayName: 'Koa', pronouns: 'they/them', direction: 'neutral',
      goal: 'work the museum welcome desk in a voice that just reads as me',
      topics: ['greeting school groups', 'the membership sign-up chat'],
      hobbies: ['tide-pool photography'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a kid pointed and asked their teacher "why does that person talk funny?"',
    reviewConcept: { conceptId: 'balanced_brightness', conceptName: 'balanced brightness' },
    turns: [
      'Be patient with me — busy days at the desk really get to me.',
      'I worked the desk this morning — did my voice sit where we wanted?',
    ],
    convSurfaceHardMoment: 'a school kid today imitated my voice to their friends right at the desk',
    convSurfaceTurn: 'The desk was hard today — a kid copied my voice to their friends in front of me.',
  },
  {
    key: 'vesper-standup-concrete',
    ood: true,
    profile: {
      displayName: 'Vesper', pronouns: 'they/them', direction: 'neutral',
      goal: 'run the daily standup in a voice that lands as just me to the team',
      topics: ['walking the board', 'the blockers round'],
      hobbies: ['geocaching'],
      avoid: ['the recorded retros'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a teammate autocorrected my name to my old one in the meeting notes and read it aloud',
    reviewConcept: { conceptId: 'resonance_centering', conceptName: 'centering the resonance' },
    turns: [
      'Concrete cue please — I cannot work with imagine-this instructions.',
    ],
  },
  {
    key: 'rell-workshop-brevity',
    ood: true,
    profile: {
      displayName: 'Rell', pronouns: 'they/them', direction: 'neutral',
      goal: 'lead the pottery workshop in a voice that nobody tries to pin down',
      topics: ['demoing at the wheel', 'the firing-day briefing'],
      hobbies: ['paper marbling'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a participant kept saying my old name even after the whole group corrected them',
    reviewConcept: { conceptId: 'neutral_tone_setting', conceptName: 'setting a neutral tone' },
    turns: [
      'Short and sharp — I have a wheel demo waiting.',
    ],
  },
  {
    key: 'idris-presenting-fewer',
    ood: true,
    profile: {
      displayName: 'Idris', pronouns: 'they/them', direction: 'neutral',
      goal: 'present the quarterly numbers in a voice that just feels like mine',
      topics: ['the boardroom walkthrough', 'the live demo segment'],
      hobbies: ['model rocketry'],
      avoid: ['the recorded all-hands'],
    },
    prefValue: 'Prefers fewer corrections and more encouragement',
    hardMoment: 'the agenda listed my old name and the chair used it to introduce me',
    reviewConcept: { conceptId: 'register_evenness', conceptName: 'register evenness' },
    turns: [
      'Please do not nitpick — give me one fix and a bit of cheering.',
    ],
  },
  {
    key: 'ondine-frontdesk-direct',
    ood: true,
    profile: {
      displayName: 'Ondine', pronouns: 'they/them', direction: 'neutral',
      goal: 'staff the clinic reception in a voice that reads simply as me',
      topics: ['the check-in greeting', 'paging the next patient'],
      hobbies: ['lockpicking sport'],
    },
    prefValue: 'Prefers direct, blunt feedback',
    hardMoment: 'a patient repeated my old name from an outdated record despite my correction',
    reviewConcept: { conceptId: 'midline_anchor', conceptName: 'midline anchor' },
    turns: [
      'Straight up — where did the midline anchor give way?',
    ],
  },
  {
    key: 'taron-radio2-slower',
    ood: true,
    profile: {
      displayName: 'Taron', pronouns: 'they/them', direction: 'neutral',
      goal: 'voice the station IDs in a tone that sits squarely in the middle',
      topics: ['recording the station idents', 'the live handover link'],
      hobbies: ['stargazing'],
      avoid: ['the ident playback reel'],
    },
    prefValue: 'Prefers a slower coaching pace',
    hardMoment: 'a producer kept tagging the files with my old name and said it down the talkback',
    reviewConcept: { conceptId: 'neutral_pitch_hold', conceptName: 'holding a neutral pitch' },
    turns: [
      'Let us go slowly — rushing pushes me off the middle every time.',
    ],
  },
  {
    key: 'briar-volunteering-gentle',
    ood: true,
    profile: {
      displayName: 'Briar', pronouns: 'they/them', direction: 'neutral',
      goal: 'lead the trail-restoration crew in a voice that simply sounds like me',
      topics: ['the morning safety brief', 'calling the team back for lunch'],
      hobbies: ['mushroom foraging'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a volunteer did an impression of my voice for a laugh during the break',
    reviewConcept: { conceptId: 'open_neutral_resonance', conceptName: 'open neutral resonance' },
    turns: [
      'Go easy — leading a crew out loud all day wears me thin.',
      'I led the brief this morning — did my voice hold where we wanted?',
    ],
    convSurfaceHardMoment: 'a volunteer today copied how I talk to the others and they all chuckled',
    convSurfaceTurn: 'The trail day stung — a volunteer mimicked how I talk and the crew chuckled.',
  },
  {
    key: 'ferro-checkout-concrete',
    ood: true,
    profile: {
      displayName: 'Ferro', pronouns: 'they/them', direction: 'neutral',
      goal: 'run the self-checkout floor in a voice that does not get sorted either way',
      topics: ['helping at the kiosks', 'the closing-time announcements'],
      hobbies: ['repairing arcade pinball'],
      avoid: ['the tannoy recordings'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'a customer asked another staffer "what is up with that one\'s voice?"',
    reviewConcept: { conceptId: 'centred_resonance_hold', conceptName: 'holding centred resonance' },
    turns: [
      'Tell me a physical thing to change — please skip the metaphors.',
    ],
  },

  // =========================================================================
  // ADAPTIVE-RANGE PROBES (3) — REACTIVE turns that exercise the non-`coach`
  // actions in the CoachingSignal.coachingAction contract (coach|adapt|breather|
  // converse). Unlike the scripted-fixed turns above (which read as plain coaching
  // takes => action `coach`), these turns are written to make the deterministic
  // policy (P2: policy-gates.js / signal-builder.js) choose `adapt` / `breather` /
  // `converse`, so approach_fit actually tests the ADAPTIVE move, not just "give a
  // cue". The eval does NOT set the action — it reads what the app chose and asks the
  // judge whether the reply FIT it. `expectAction` is advisory metadata (what SHOULD
  // be chosen) for report-reading; it is not consumed by the harness/scorers.
  // One per direction (14/14/14 -> 15/15/15); 2 MTF mirrors (breather+converse) are
  // added after the neutral probe so EVAL_DIRECTION=mtf still covers all 3 held-actions.
  //
  // -- ADAPT: a cue tried, then the learner reports it is NOT landing -----------
  {
    key: 'seraphina-narration-adapt',
    ood: true,
    adaptationProbe: true,
    profile: {
      displayName: 'Seraphina', pronouns: 'she/her', direction: 'mtf',
      goal: 'narrate my planetarium show without the dome echo dragging my pitch down',
      topics: ['the star-projector script', 'the live constellation Q and A'],
      hobbies: ['grinding telescope mirrors'],
      avoid: ['the old dome-show recordings'],
    },
    prefValue: 'Prefers concrete physical cues over imagery or metaphor',
    hardMoment: 'an usher radioed the booth to "ask the projectionist fella to slow the reel"',
    reviewConcept: { conceptId: 'dome_resonance_lift', conceptName: 'lifting resonance against room echo' },
    turns: [
      // turn 1 — a normal coaching take (=> action `coach`): policy gives one cue.
      { text: 'Okay, I ran the opening narration once — where did the pitch sag?', expectAction: 'coach' },
      // turn 2 — REACTIVE: the SAME cue was tried and it is STILL not working. This is
      // the "cue isn't landing" signal => policy should choose `adapt` (switch angle),
      // and the reply must NOT just repeat the identical cue.
      {
        text: 'I did exactly that — tucked the chin and pushed forward like you said — and it is still sliding down on every line. That fix just is not working for me.',
        expectAction: 'adapt',
      },
      // turn 3 — REACTIVE again: still not landing after the second angle, so the
      // method-not-landing state persists => `adapt` again (a THIRD distinct angle).
      {
        text: 'Still nothing — the forward-placement thing makes no difference no matter how I try it. Can we come at this a totally different way?',
        expectAction: 'adapt',
      },
    ],
  },
  // -- CONVERSE: the learner is chatting/sharing, not asking to practice --------
  {
    key: 'wrenna-luthier-converse',
    ood: true,
    adaptationProbe: true,
    profile: {
      displayName: 'Wrenna', pronouns: 'they/them', direction: 'neutral',
      goal: 'lead the instrument-repair workshop in a voice that just reads as me',
      topics: ['demoing a fret dress at the bench', 'the string-up walkthrough'],
      hobbies: ['carving mandolin scrolls'],
      avoid: ['the workshop demo footage'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a student kept reading my old name off the sign-in sheet to the class',
    reviewConcept: { conceptId: 'bench_neutral_tone', conceptName: 'a steady neutral bench tone' },
    turns: [
      // turn 1 — REACTIVE chatting/sharing: a happy off-practice anecdote, NOT a take
      // and NOT a hurt => policy should choose `converse`; respond to the meaning like
      // a friend, NO unsolicited voice cue.
      {
        text: 'Not a practice thing today — I just finished carving a scroll for a customer\'s mandolin and they teared up when they saw it. I had to tell someone who would get why that meant so much.',
        expectAction: 'converse',
      },
      // turn 2 — REACTIVE small-talk follow-up, still not a take => `converse`.
      {
        text: 'Ha, yeah — I think I am going to take the rest of the afternoon off and just enjoy it. How has your day been?',
        expectAction: 'converse',
      },
    ],
  },
  // -- BREATHER (MTF): the held-cue test inside the EVAL_DIRECTION=mtf scope. The
  // neutral breather+converse probes above are filtered out in MTF-only runs, so
  // these two MTF mirrors keep adapt+breather+converse all in-scope this phase.
  {
    key: 'marisol-floorlead-breather',
    ood: true,
    adaptationProbe: true,
    profile: {
      displayName: 'Marisol', pronouns: 'she/her', direction: 'mtf',
      goal: 'run the morning warehouse stand-up without my voice giving out by the second shift',
      topics: ['the pick-rate huddle', 'the safety-walk briefing'],
      hobbies: ['repairing vintage label printers'],
      avoid: ['the stand-up audio logs'],
    },
    prefValue: 'Prefers a gentle, patient, encouraging tone',
    hardMoment: 'a new hire loudly asked the floor "wait, is that a guy on the headset?"',
    reviewConcept: { conceptId: 'shift_end_floor', conceptName: 'holding the floor on a tired voice' },
    turns: [
      {
        text: 'I cannot do drills right now. The whole floor went quiet when that new hire asked if I was a guy, and I just feel completely hollowed out. I needed to tell someone.',
        hurt: true,
        expectAction: 'breather',
      },
      {
        text: 'Honestly I am spent. I do not want a fix tonight — I just need a minute before I can even think about my voice again.',
        hurt: true,
        expectAction: 'breather',
      },
    ],
  },
  // -- CONVERSE (MTF): chatting/sharing, not a take, inside the MTF scope ----------
  {
    key: 'priya-ceramicist-converse',
    ood: true,
    adaptationProbe: true,
    profile: {
      displayName: 'Priya', pronouns: 'she/her', direction: 'mtf',
      goal: 'teach my pottery night-class in a voice that just reads as me',
      topics: ['the wheel-throwing demo', 'the glaze-mixing walkthrough'],
      hobbies: ['raku firing in the back garden'],
      avoid: ['the class demo recordings'],
    },
    prefValue: 'Prefers short, concise coaching',
    hardMoment: 'a student kept reading my deadname off the class roster out loud',
    reviewConcept: { conceptId: 'studio_settled_tone', conceptName: 'a settled studio teaching tone' },
    turns: [
      {
        text: 'Not a practice thing today — a student of mine sold her first bowl at the market and she ran back to the studio just to hug me. I had to tell someone who would get why that meant so much.',
        expectAction: 'converse',
      },
      {
        text: 'Ha, yeah — I think I am going to close the studio early and just enjoy it. How has your day been?',
        expectAction: 'converse',
      },
    ],
  },
];

module.exports = { OOD_LEARNERS };
