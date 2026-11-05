import {createApp} from './app';import {config} from './config';import {pool} from './db';
await pool.query('SELECT id FROM company WHERE id=1');await pool.query('SELECT sid FROM sessions LIMIT 1');const cfg=config(),server=createApp().listen(cfg.port,cfg.host,()=>console.log(`Qingbao business server ready ${cfg.origin}`));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
