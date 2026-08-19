// Targeted test: TTS proxy with referenceClipId resolution
const http = require('http');
let pass = 0, fail = 0;
function assert(c,m){ if(c){pass++;} else {fail++; console.error('FAIL:',m);} }
function post(path, body){
  return new Promise(function(resolve, reject){
    var data = JSON.stringify(body);
    var req = http.request({ host:'127.0.0.1', port:3021, path:path, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)} },
      function(res){ var body=''; res.on('data',function(d){body+=d;}); res.on('end',function(){resolve({status:res.statusCode,body:body,headers:res.headers});}); });
    req.on('error',reject); req.write(data); req.end();
  });
}
function postForm(path, formData){
  return new Promise(function(resolve, reject){
    var boundary = '----test' + Date.now();
    var parts = [];
    formData.forEach(function(f){
      parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="' + f.name + '"; filename="' + f.filename + '"\r\nContent-Type: ' + f.contentType + '\r\n\r\n');
    });
    resolve({ boundary: boundary });
  });
}
async function run(){
  // 1. Upload a reference to get a clipId
  var fs = require('fs');
  var clipId = null;
  var uploadResult = await new Promise(function(resolve, reject){
    var fileData = fs.readFileSync('/tmp/aster-voice/aster-voice-ref.wav');
    var boundary = '----test' + Date.now();
    var body = '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="aster-voice-ref.wav"\r\n' +
      'Content-Type: audio/wav\r\n\r\n';
    var endBuf = Buffer.from('\r\n--' + boundary + '--\r\n');
    var fullBody = Buffer.concat([Buffer.from(body), fileData, endBuf]);
    var req = http.request({ host:'127.0.0.1', port:3021, path:'/voice/upload-reference', method:'POST',
      headers:{'Content-Type':'multipart/form-data; boundary=' + boundary, 'Content-Length': fullBody.length} },
      function(res){ var data=''; res.on('data', function(d){data+=d;}); res.on('end', function(){
        try { resolve(JSON.parse(data)); } catch(e){ reject(new Error('bad JSON: ' + data.slice(0,100))); }
      }); });
    req.on('error',reject); req.write(fullBody); req.end();
  });
  clipId = uploadResult.clipId;
  assert(clipId && clipId.length > 10, 'upload returns valid clipId: ' + clipId);

  // 2. TTS WITH referenceClipId → should resolve and return audio
  var ttsWithRef = await post('/voice/tts', {
    text: 'Testing voice reference resolution through the gateway.',
    referenceClipId: clipId
  });
  assert(ttsWithRef.status === 200, 'TTS with referenceClipId returns 200, got ' + ttsWithRef.status);
  assert(ttsWithRef.body.length > 1000, 'TTS with reference returns audio data > 1KB: ' + ttsWithRef.body.length + ' bytes');
  assert(ttsWithRef.headers['content-type'].includes('audio'), 'TTS with reference returns audio content-type: ' + ttsWithRef.headers['content-type']);

  // 3. TTS WITHOUT referenceClipId → should still work (default voice)
  var ttsNoRef = await post('/voice/tts', {
    text: 'Testing default voice without reference.'
  });
  assert(ttsNoRef.status === 200, 'TTS without reference returns 200');
  assert(ttsNoRef.body.length > 1000, 'TTS without reference returns audio data > 1KB');

  // 4. TTS with INVALID clipId → should gracefully fall back to default voice (not 500)
  var ttsBadRef = await post('/voice/tts', {
    text: 'Testing fallback for bad clipId.',
    referenceClipId: 'nonexistent-clip-id-12345'
  });
  assert(ttsBadRef.status === 200, 'TTS with bad clipId gracefully falls back to 200, got ' + ttsBadRef.status);

  // 5. TTS with empty text → should 400
  var ttsEmpty = await post('/voice/tts', { text: '', referenceClipId: clipId });
  assert(ttsEmpty.status === 400, 'TTS with empty text returns 400');

  // 6. Check server log for resolution chain
  var logResp = await new Promise(function(resolve, reject){
    http.get('http://127.0.0.1:3021/debug/log/grep?q=resolved+clipId', function(res){
      var data=''; res.on('data', function(d){data+=d;}); res.on('end', function(){ resolve(data); });
    }).on('error',reject);
  });
  assert(logResp.includes('resolved clipId'), 'server log contains clipId resolution: ' + logResp.slice(0,80));

  console.log('\n=== TTS reference resolution: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}
run().catch(function(e){ console.error('FATAL:', e); process.exit(1); });
