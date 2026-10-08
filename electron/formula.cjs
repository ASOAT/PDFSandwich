// One local inference at a time: avoid competing model downloads and RAM spikes.
class FormulaRecognizer {
  constructor(run) { this.run=run; this.pending=new Map(); this.cache=new Map(); this.tail=Promise.resolve(); }
  recognize(id,args,retry=false) {
    if(this.pending.has(id))return this.pending.get(id);
    if(!retry&&this.cache.has(id))return Promise.resolve(this.cache.get(id));
    const task=this.tail.then(()=>this.run(args)).then(result=>{
      this.cache.set(id,result);
      if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);
      return result;
    }).finally(()=>this.pending.delete(id));
    this.pending.set(id,task);
    this.tail=task.catch(()=>{});
    return task;
  }
}
module.exports={FormulaRecognizer};
