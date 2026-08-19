const http = require('http');
let pass = 0, fail = 0;
function assert(c,m){ if(c){pass++;} else {fail++; console.error('FAIL:',m);} }
function get(path){
  return new Promise(function(resolve, reject){
    http.get('http://127.0.0.1:3021' + path, function(res){
      var data = '';
      res.on('data', function(d){ data += d; });
      res.on('end', function(){ resolve({ status: res.statusCode, body: data, headers: res.headers }); });
    }).on('error', reject);
  });
}
async function run(){
  var health = await get('/health');
  assert(JSON.parse(health.body).status === 'online', 'health online');

  var tail = await get('/debug/log/tail?lines=3');
  assert(tail.status === 200, 'tail returns 200');
  assert(tail.headers['content-type'].includes('text/plain'), 'tail returns text/plain');
  assert(tail.body.length > 0, 'tail returns non-empty body');

  var grep = await get('/debug/log/grep?q=coach-debug');
  assert(grep.status === 200, 'grep returns 200');
  assert(grep.headers['content-type'].includes('text/plain'), 'grep returns text/plain');

  var badGrep = await get('/debug/log/grep?q=[');
  assert(badGrep.status === 200, 'invalid regex returns 200');

  var summary = await get('/debug/summary');
  var sBody = JSON.parse(summary.body);
  assert(typeof sBody.logFileLines === 'number', 'summary.logFileLines is number');
  assert(typeof sBody.streamHealthy === 'boolean', 'summary.streamHealthy is boolean');
  assert(sBody.logFileLines > 0, 'summary.logFileLines > 0');

  var coach = await get('/coach');
  assert(coach.status === 302, 'coach route returns 302 redirect');
  assert((coach.headers.location || '').indexOf('/app?mode=coach') === 0, 'coach redirects to /app?mode=coach');

  var coachLegacy = await get('/coach-legacy');
  assert(coachLegacy.status === 200, 'coach-legacy page returns 200');
  assert(coachLegacy.body.includes('voice-guide'), 'coach-legacy page has voice-guide div');
  assert(coachLegacy.body.includes('Minimum 3'), 'coach-legacy page shows minimum 3s');
  assert(coachLegacy.body.includes('maximum 30s'), 'coach-legacy page shows maximum 30s');

  var js = await get('/static/coach-app.js');
  assert(js.status === 200, 'coach-app.js returns 200');
  assert(js.body.includes('showError'), 'coach-app.js has showError');
  assert(js.body.includes('upload-reference'), 'coach-app.js uses upload-reference');
  assert(js.body.includes('trimWarning'), 'coach-app.js handles trimWarning');

  console.log('\n=== runtime endpoints: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}
run().catch(function(e){ console.error('FATAL:', e); process.exit(1); });
