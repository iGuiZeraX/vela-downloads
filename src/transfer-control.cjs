const {performance}=require('node:perf_hooks');

// Use a monotonic clock and received bytes, independently of disk retry corrections.
class SpeedMeter {
  constructor(now=performance.now()) { this.samples=[{at:now,bytes:0}]; this.total=0; }
  add(bytes) { this.total+=bytes; }
  sample(now=performance.now()) {
    this.samples.push({at:now,bytes:this.total});
    const cutoff=now-3000;
    while(this.samples.length>2 && this.samples[1].at<=cutoff) this.samples.shift();
    const first=this.samples[0], elapsed=now-first.at;
    return elapsed>0 ? Math.max(0,(this.total-first.bytes)*1000/elapsed) : 0;
  }
}

class ConnectionController {
  constructor({maximum,automatic,now=performance.now()}) {
    this.maximum=maximum; this.automatic=automatic;
    this.limit=automatic?Math.min(8,maximum):maximum;
    this.nextReview=now+2000; this.nextReduction=now; this.blockedUntil=0;
    this.previousRate=0; this.recoveryUntil=0;
  }
  review(rate,now=performance.now()) {
    if(!this.automatic || now<this.nextReview || now<this.recoveryUntil || !rate)return this.limit;
    const improved=!this.previousRate || rate>=this.previousRate*1.1;
    this.previousRate=rate;
    // Probe less often once more sockets stop increasing useful throughput.
    this.nextReview=now+(improved?2000:8000);
    if(improved)this.limit=Math.min(this.maximum,Math.ceil(this.limit*1.5));
    return this.limit;
  }
  throttle(waitMs,now=performance.now()) {
    // A burst of simultaneous 429s represents one congestion event.
    if(now>=this.nextReduction){this.limit=Math.max(1,Math.floor(this.limit/2));this.nextReduction=now+1000;}
    this.blockedUntil=Math.max(this.blockedUntil,now+Math.max(1000,waitMs));
    this.recoveryUntil=Math.max(this.recoveryUntil,this.blockedUntil+15000);
    this.previousRate=0;
    return this.limit;
  }
  waitMs(now=performance.now()) {return Math.max(0,this.blockedUntil-now);}
}

module.exports={SpeedMeter,ConnectionController};
