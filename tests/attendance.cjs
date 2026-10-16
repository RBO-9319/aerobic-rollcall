const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.TZ = 'Asia/Taipei';
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {
    value:'', textContent:'', innerHTML:'', hidden:false, open:false,
    classList:{toggle(){},add(){},remove(){}}, addEventListener(){},
    showModal(){this.open=true;}, close(){this.open=false;}, reset(){},
  });
  return nodes.get(selector);
}
let saved='',alerts=[];
class TestDate extends Date {
  constructor(...args){super(...(args.length?args:['2026-10-19T10:00:00+08:00']));}
}
const ctx = vm.createContext({
  Date:TestDate,Intl,console,crypto:require('node:crypto').webcrypto,
  window:{addEventListener(){}},navigator:{},
  document:{querySelector:node,querySelectorAll:()=>[]},
  localStorage:{getItem:()=>null,setItem:(key,value)=>{saved=value;}},
  setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
  alert:message=>alerts.push(message)
});
const cut=source.lastIndexOf("  $('#todayLabel')");
assert.ok(cut>0);
vm.runInContext(source.slice(0,cut)+
  'globalThis.api={get state(){return state},set state(x){state=x},bind,checkIn,migrate,selectedLesson,recordTimeText,renderStudents};})();',ctx);
const api=ctx.api;
function fixture() {
  api.state={version:5,leavePolicyVersion:2,activeClassId:'fri',
    rooms:[{id:'room',name:'測試教室'}],
    classes:[{id:'fri',name:'週五早班',roomId:'room',weekday:5},{id:'mon',name:'週一班',roomId:'room',weekday:1}],
    students:[{id:'s',classId:'fri',name:'測試學生',remaining:6,enrolledAt:'2026-09-01',baseExpiresAt:'2026-10-18',expiresAt:'2026-10-18'}],
    records:[],sessions:[],closures:[],
    attendanceSelections:[{classId:'fri',date:'2026-10-16',time:'09:30'}]};
  alerts=[];
}
api.bind();
fixture();
api.checkIn('s');
assert.equal(api.state.records.length,0,'must not deduct before confirmation');
assert.equal(api.state.students[0].remaining,6);
assert.ok(node('#offDayCheckinDialog').open);
assert.match(node('#offDayCheckinText').textContent,/2026\/10\/16.*09:30/);
node('#offDayCheckinDialog').close();
assert.equal(api.state.records.length,0,'cancel leaves records unchanged');
api.checkIn('s');
node('#confirmOffDayCheckin').onclick();
assert.equal(api.state.students[0].remaining,5);
const record=api.state.records[0];
assert.equal(record.eventDate,'2026-10-16');
assert.equal(record.eventTime,'09:30');
assert.match(record.createdAt,/2026-10-19/);
assert.match(api.recordTimeText(record),/簽到課堂：2026\/10\/16（星期五） 09:30/);
assert.match(api.recordTimeText(record),/登錄：2026\/10\/19/);
node('#confirmOffDayCheckin').onclick();
api.checkIn('s');
assert.equal(api.state.records.length,1,'duplicate does not deduct again');
const restored=api.migrate(JSON.parse(saved));
assert.equal(restored.records[0].eventTime,'09:30');
assert.equal(restored.attendanceSelections[0].date,'2026-10-16');
assert.equal(restored.students[0].remaining,5);
api.state=restored;
api.state.activeClassId='mon';
assert.equal(api.selectedLesson().date,'2026-10-19');
api.state.activeClassId='fri';
assert.equal(api.selectedLesson().date,'2026-10-16');
assert.equal(api.selectedLesson().time,'09:30');
fixture();
api.state.records=[{...record,eventTime:''}];
api.checkIn('s');
assert.equal(api.state.students[0].remaining,6,'legacy untimed record prevents double charge');
fixture();
api.state.records=[{...record,type:'leave'}];
api.checkIn('s');
assert.equal(api.state.students[0].remaining,6,'leave date blocks checkin');
fixture();
api.state.attendanceSelections[0].date='2026-10-19';
api.state.students[0].expiresAt='2026-11-01';
api.checkIn('s');
assert.equal(api.state.records.length,1,'same-day attendance needs no off-day confirmation');
fixture();
api.state.attendanceSelections[0].time='';
api.checkIn('s');
assert.equal(api.state.records.length,0);
assert.equal(alerts.length,1,'missing time requires selection');
fixture();
api.state.attendanceSelections[0].date='2026-10-23';
api.checkIn('s');
assert.equal(api.state.records.length,0,'eligibility uses selected class date');
console.log('PASS: backdated confirmation/cancel, class date/time, actual timestamp, duplicate/leave guards, migration, class selection persistence, same-day and expiry checks.');
