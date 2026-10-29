import {parentPort} from 'node:worker_threads';
globalThis.self={
  postMessage:(message,transfer)=>parentPort.postMessage(message,transfer),
  onmessage:null
};
await import('../optimizer.worker.js');
parentPort.on('message',data=>globalThis.self.onmessage?.({data}));
