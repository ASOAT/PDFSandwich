// Batch scroll-only draft writes, but bound loss on an unexpected exit.
class ReadingSave {
  constructor(write, {delay=500, maxWait=2000, timers=globalThis}={}) {
    Object.assign(this,{write,delay,maxWait,timers});
  }
  request() {
    this.timers.clearTimeout(this.quiet);
    this.quiet=this.timers.setTimeout(()=>this.flush(),this.delay);
    this.limit ??= this.timers.setTimeout(()=>this.flush(),this.maxWait);
  }
  cancel() {
    this.timers.clearTimeout(this.quiet);this.timers.clearTimeout(this.limit);
    this.quiet=this.limit=undefined;
  }
  flush() { const pending=this.limit!==undefined;this.cancel();if(pending)this.write(); }
}
module.exports={ReadingSave};
