const fs = require('node:fs');
const path = require('node:path');
function seed(db, seasons = 1, entries = 0, maps = 1) {
  db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days) VALUES (1,'Fixture',1,1,'2026-01-01',100000,0,0);
    INSERT INTO season_template_maps(id,season_template_id,name,order_index) VALUES (1,1,'Map',1);
    INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100000000,1);`);
  db.transaction(() => {
    for(let m=2;m<=maps;m++) db.prepare('INSERT INTO season_template_maps(id,season_template_id,name,order_index) VALUES (?,1,?,?)').run(m,`Map ${m}`,m);
    const insert = db.prepare('INSERT INTO entries(gym_season_id,round_number,season_template_map_id,member_id,tickets_used,points_scored,created_at) VALUES (?,1,?,?,1,1,?)');
    for (let s = 1; s <= seasons; s++) {
      db.prepare('INSERT INTO gyms(id,name,slug,admin_code) VALUES (?,?,?,?)').run(s,'Fixture',`fixture-${s}`,`fixture-password-${s}`);
      db.prepare('INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (?,?,1)').run(s,s);
      db.prepare("INSERT INTO gym_round_status(gym_season_id,round_number,status) VALUES (?,1,'active')").run(s);
      for (let m = 1; m <= 100; m++) db.prepare('INSERT INTO members(id,gym_season_id,name) VALUES (?,?,?)').run((s-1)*100+m,s,`Member ${m}`);
      for (let i = 0; i < entries; i++) insert.run(s,Math.floor(i/100)%maps+1,(s-1)*100+i%100+1,new Date(1700000000000+i*1000).toISOString());
    }
  })();
}
// Read the actual route SQL: changes to the routes are reflected in the evidence.
function queries() {
  const result = [];
  for (const file of ['gym-public.js','gym-admin.js']) {
    const source = fs.readFileSync(path.join(__dirname,'../routes',file),'utf8');
    for (const match of source.matchAll(/db\.prepare\(`([^`]*?)`\)\.all\(gymSeason.id\)/g)) {
      if (/FROM entries|JOIN entries/.test(match[1])) result.push({name:`${file}:${source.slice(0,match.index).split('\n').length}`,sql:match[1]});
    }
    if (file === 'gym-admin.js') {
      const sql = source.match(/db\.prepare\(`(\s*SELECT e\.\*,[\s\S]*?)`\)\.all\(req.gymSeason.id\)/)[1];
      result.push({name:'admin log',sql});
    }
  }
  return result;
}
module.exports = {seed,queries};

