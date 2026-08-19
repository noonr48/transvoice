/* ═══════════════════════════════════════════════════════════
   Phonetic Dictionary — pronunciation spelling transformer
   Converts English text to pronunciation spelling:
   "Hello there" → "huh-LOH THAIR"
   Stressed syllables in CAPS, hyphens join syllables.
   ═══════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  // ── Dictionary: high-frequency coach words → pronunciation spelling ──
  var dict = {
    'hello':'huh-LOH', 'hi':'hIGH', 'hey':'HAY', 'goodbye':'guhd-BIGH',
    'yes':'YEHS', 'no':'NOH', 'okay':'oh-KAY', 'sure':'SHUR',
    'great':'GRAYT', 'good':'GUHD', 'well':'WEHL',
    'how':'HOW', 'what':'WUHT', 'when':'WHEHN', 'where':'WHAIR',
    'why':'WHIGH', 'who':'HOO', 'which':'WHIHCH',
    'your':'YOOR', 'you':'YOO', 'you\'re':'YOOR',
    'doing':'DOO-ing', 'going':'GOH-ing', 'saying':'SAY-ing',
    'think':'THINGK', 'feeling':'FEEL-ing', 'sounds':'SOWNDZ',
    'that':'THAHT', 'this':'THIHS', 'the':'thuh', 'there':'THAIR',
    'their':'THAIR', 'they\'re':'THAIR', 'here':'HEER',
    'have':'HAV', 'had':'HAD', 'has':'HAZ',
    'been':'BEHN', 'being':'BEE-ing', 'am':'AM', 'is':'IZ', 'are':'AR',
    'was':'WUZ', 'were':'WUR',
    'can':'KAN', 'could':'KUUD', 'would':'WUUD', 'should':'SHUUD',
    'will':'WIL', 'won\'t':'WOHNT', 'want':'WAHNT', 'wanted':'WAHN-tid',
    'like':'LIGHK', 'really':'REE-uh-lee', 'very':'VAIR-ee',
    'much':'MUHCH', 'more':'MOHR', 'most':'MOHST',
    'not':'NAHT', 'don\'t':'DOHNT', 'doesn\'t':'DUZ-unt',
    'didn\'t':'DID-unt', 'isn\'t':'IZ-unt', 'aren\'t':'AR-unt',
    'wasn\'t':'WUZ-unt', 'weren\'t':'WUR-unt',
    'about':'uh-BOWT', 'because':'bih-KUHZ',
    'before':'bih-FOHR', 'after':'AFF-tuhr',
    'with':'WIHTH', 'without':'with-OWT',
    'for':'FOHR', 'from':'FRAHM', 'but':'BUHT',
    'and':'AND', 'or':'OHR', 'so':'SOH',
    'if':'IFF', 'then':'THEHN', 'just':'JUHST',
    'some':'SUHM', 'any':'EHN-ee', 'every':'EHV-ree',
    'time':'TIGHM', 'now':'NOW', 'again':'uh-GEHN',
    'too':'TOO', 'also':'AHL-soh', 'even':'EE-vun',
    'let\'s':'LEHTS', 'let':'LEHT',
    'try':'TRIGH', 'trying':'TRIGH-ing',
    'practice':'PRAK-tiss', 'practicing':'PRAK-tiss-ing',
    'word':'WURD', 'words':'WURDZ',
    'sentence':'SEHN-tuns', 'sentences':'SEHN-tun-siz',
    'speak':'SPEEK', 'speaking':'SPEEK-ing',
    'listen':'LIH-sun', 'listening':'LIH-sun-ing',
    'repeat':'rih-PEET', 'repeating':'rih-PEET-ing',
    'sound':'SOWND',
    'voice':'VOYS', 'voices':'VOY-siz',
    'pronunciation':'proh-nun-see-AY-shun',
    'accent':'AK-sent', 'language':'LANG-gwij',
    'english':'ING-lish', 'better':'BEH-tuhr',
    'beautiful':'BYOO-tih-ful', 'perfect':'PUR-fikt',
    'nice':'NIGHS', 'wonderful':'WUHN-tuhr-ful',
    'excellent':'EK-suh-lunt', 'awesome':'AW-sum',
    'keep':'KEEP',
    'stop':'STAHP', 'start':'START',
    'question':'KWES-chun', 'answer':'AN-suhr',
    'right':'RIGHT', 'wrong':'RAHNG',
    'correct':'kuh-REKT', 'incorrect':'in-kuh-REKT',
    'morning':'MOHR-ning', 'afternoon':'aff-tuhr-NOON',
    'evening':'EEV-ning', 'night':'NIGHT',
    'day':'DAY', 'today':'tuh-DAY',
    'tomorrow':'tuh-MAH-roh', 'yesterday':'YEH-stuhr-day',
    'week':'WEEK', 'month':'MUNTH', 'year':'YEER',
    'happy':'HAP-ee', 'sad':'SAD',
    'excited':'ik-SIGH-tid', 'tired':'TIGH-urd',
    'love':'LUHV',
    'need':'NEED',
    'help':'HEHLP', 'helping':'HEHLP-ing',
    'learn':'LURN', 'learning':'LURN-ing',
    'teacher':'TEE-chuhr', 'student':'STOO-dunt',
    'lesson':'LEH-sun', 'class':'KLAHS',
    'home':'HOHM', 'work':'WURK',
    'play':'PLAY', 'playing':'PLAY-ing',
    'food':'FOOD', 'eat':'EET', 'eating':'EET-ing',
    'water':'WAH-tuhr', 'coffee':'KAH-fee',
    'friend':'FREND', 'family':'FAM-uh-lee',
    'house':'HOWS', 'room':'ROOM',
    'door':'DOHR', 'window':'WIN-doh',
    'car':'KAHR', 'bus':'BUHS',
    'school':'SKOOL', 'book':'BUK',
    'computer':'kuhm-PYOO-tuhr', 'phone':'FOHN',
    'internet':'IN-tuhr-net', 'website':'WEB-site',
    'app':'APP', 'application':'ap-lih-KAY-shun',
    'bye':'BIGH',
    'thanks':'THANKS', 'thank':'THANK',
    'please':'PLEEZ', 'sorry':'SAH-ree',
    'welcome':'WEL-kum',
    'maybe':'MAY-bee', 'perhaps':'puhr-HAPS',
    'always':'AWL-wayz', 'never':'NEHV-uhr',
    'sometimes':'SUHM-tighmz',
    'thing':'THING', 'things':'THINGZ',
    'way':'WAY', 'ways':'WAYZ',
    'man':'MAN', 'woman':'WUHM-un',
    'boy':'BOY', 'girl':'GURL',
    'name':'NAYM', 'age':'AYJ',
    'new':'NOO',
    'old':'OHLD', 'young':'YUHNG',
    'first':'FURST', 'last':'LAST',
    'next':'NEHST', 'other':'UHTH-uhr',
    'same':'SAYM', 'different':'DIH-fuhr-unt',
    'all':'AWL', 'both':'BOHTH',
    'each':'EECH',
    'many':'MEH-nee', 'few':'FYOO',
    'one':'WUN', 'two':'TOO', 'three':'THREE',
    'four':'FOHR', 'five':'FIGHV',
    'make':'MAYK', 'made':'MAYD',
    'take':'TAYK', 'took':'TUUK',
    'get':'GEHT', 'got':'GAHT',
    'give':'GIHV', 'gave':'GAYV',
    'go':'GOH', 'went':'WEHNT',
    'come':'KUHM', 'came':'KAYM',
    'see':'SEE', 'saw':'SAW',
    'know':'NOH', 'knew':'NOO',
    'thought':'THAWT',
    'feel':'FEEL', 'felt':'FEHLT',
    'hear':'HEER', 'heard':'HURD',
    'say':'SAY', 'said':'SEHD',
    'tell':'TEHL', 'told':'TOHLD',
    'ask':'ASK', 'asked':'ASKT',
    'put':'PUHT', 'use':'YOOZ',
    'find':'FIGHND', 'found':'FAOWND',
    'worked':'WURKT',
    'call':'KAHL', 'called':'KAHLD',
    'tried':'TRIGHD',
    'become':'bih-KUHM',
    'leave':'LEEV', 'left':'LEHFT',
    'seem':'SEEM',
    'turn':'TURHN', 'begin':'bih-GIN',
    'bring':'BRING', 'happen':'HAP-un',
    'write':'RIGHT', 'show':'SHOH',
    'read':'REED', 'reading':'REED-ing'
  };

  // ── Rule-based fallback for words not in the dictionary ──
  function ruleBased(word){
    var w = word.toLowerCase();
    // Silent e → split the vowel
    if(w.length > 3 && w.endsWith('e') && 'aeiou'.indexOf(w[w.length-2]) < 0){
      var stem = w.slice(0, -1);
      if(stem.match(/a$/)) return 'AY';
      if(stem.match(/i$/)) return 'IGH';
      if(stem.match(/o$/)) return 'OH';
      if(stem.match(/u$/)) return 'YOO';
    }
    // Common suffixes
    w = w.replace(/ing$/,'-ing');
    w = w.replace(/tion$/,'-shun');
    w = w.replace(/sion$/,'-zhun');
    w = w.replace(/ful$/,'-ful');
    w = w.replace(/ly$/,'-lee');
    w = w.replace(/ness$/,'-niss');
    w = w.replace(/ment$/,'-mehnt');
    w = w.replace(/able$/,'-uh-bul');
    w = w.replace(/ible$/,'-ih-bul');
    // Double consonants → syllable break
    w = w.replace(/([aeiou])([^aeiou])([aeiou])/g, function(m, v1, c, v2){
      return v1 + '-' + c + v2;
    });
    // Capitalize stressed-looking long words (>4 chars, first vowel)
    if(w.length > 4 && w.indexOf('-') > 0){
      var parts = w.split('-');
      var maxIdx = 0;
      for(var i = 1; i < parts.length; i++){
        if(parts[i].length > parts[maxIdx].length) maxIdx = i;
      }
      parts[maxIdx] = parts[maxIdx].toUpperCase();
      w = parts.join('-');
    }
    return w;
  }

  // ── Main: convert text to phonetic spelling ──
  function toPhonetic(text){
    if(!text) return '';
    var words = text.split(/\s+/);
    var result = [];
    for(var i = 0; i < words.length; i++){
      var raw = words[i];
      if(!raw) continue;
      var punct = raw.match(/[^a-zA-Z\']/g);
      var core = raw.replace(/[^a-zA-Z\']/g, '').toLowerCase();
      if(!core){
        if(raw) result.push(raw);
        continue;
      }
      var ph = dict[core] || ruleBased(core);
      ph = ph.replace(/([A-Z][A-Z\-]+)/g, '<span class="phonetic-stress">$1</span>');
      if(punct && punct.length > 0) ph += punct[punct.length - 1];
      result.push(ph);
    }
    return result.join(' ');
  }

  // Expose globally
  window.toPhonetic = toPhonetic;
})();
