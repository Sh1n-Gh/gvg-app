const {parentPort,workerData} = require('node:worker_threads');
const {createDb} = require('../db');
const engine = require('../engine');
const db = createDb(workerData.filename,{env:{NODE_ENV:'production'}});
parentPort.postMessage({ready:true});
parentPort.once('message', async () => {
  try {
    if(workerData.mode==='hold') {
      db.exec('BEGIN IMMEDIATE');
      parentPort.postMessage({locked:true});
      await new Promise(r=>setTimeout(r,workerData.ms));
      db.exec('COMMIT');
    } else {
      const template=db.prepare('SELECT * FROM season_templates WHERE id=1').get();
      for(let i=0;i<100;i++) {
        if(workerData.mode==='write') engine.createEntry(db,{gymSeasonId:1,roundNumber:1,mapId:1,memberId:1,ticketsUsed:1,pointsScored:1,seasonTemplate:template,nowMs:Date.now()});
        else db.transaction(()=>{
          const total=db.prepare('SELECT COALESCE(SUM(points_scored),0) n FROM entries').get().n;
          const progress=db.prepare('SELECT COALESCE(SUM(current_points),0) n FROM gym_round_map_progress').get().n;
          if(total!==progress) throw new Error('inconsistent snapshot');
        })();
        await new Promise(r=>setTimeout(r,1));
      }
    }
    parentPort.postMessage({done:true});
  } catch(error) {parentPort.postMessage({error:error.code||error.message});}
  finally {db.close();}
});
