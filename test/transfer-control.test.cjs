const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SpeedMeter,ConnectionController}=require('../src/transfer-control.cjs');

test('three-second received-byte rate dampens bursts and reaches zero on a real stall',()=>{
  const meter=new SpeedMeter(0),raw=[],smooth=[];let previous=0;
  for(let t=500;t<=10000;t+=500){
    if(t%1000===0)meter.add(1024*1024);
    const rate=meter.sample(t);
    if(t>=3000){raw.push((meter.total-previous)*2);smooth.push(rate);}
    previous=meter.total;
  }
  const variation=values=>{const mean=values.reduce((a,b)=>a+b)/values.length;return Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length)/mean;};
  assert(variation(smooth)<variation(raw)/4);
  for(let t=10500;t<=13500;t+=500)meter.sample(t);
  assert.equal(meter.sample(14000),0,'a stopped transfer must not retain a fictitious speed');
});

test('automatic connections grow with useful throughput and hold on a plateau',()=>{
  const c=new ConnectionController({maximum:32,automatic:true,now:0});
  assert.equal(c.limit,8);
  assert.equal(c.review(100,1999),8);
  assert.equal(c.review(100,2000),12);
  assert.equal(c.review(100,4000),12);
  assert.equal(c.review(200,6000),12,'no rapid probing after a plateau');
  assert.equal(c.review(200,12000),18);
  assert.equal(c.review(300,14000),27);
  assert.equal(c.review(450,16000),32);
  assert.equal(c.review(900,18000),32);
});

test('one simultaneous rejection burst halves once and blocks all new work until Retry-After',()=>{
  const c=new ConnectionController({maximum:32,automatic:true,now:0});
  assert.equal(c.throttle(5000,100),4);
  for(let t=101;t<110;t++)assert.equal(c.throttle(5000,t),4);
  assert(c.waitMs(1000)>=4000);
  assert.equal(c.waitMs(5110),0);
  assert.equal(c.review(100000,6000),4,'avoid reopening sockets during recovery');
  assert.equal(c.throttle(1000,6200),2,'a later congestion event can reduce again');
});

test('manual connection choice remains fixed without server rejection',()=>{
  const c=new ConnectionController({maximum:16,automatic:false,now:0});
  assert.equal(c.review(1000,10000),16);
  assert.equal(c.throttle(1000,11000),8,'server limits still apply to manual mode');
});
