const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Omega-Key"
};

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {"Content-Type":"application/json", ...CORS}
});

const now = () => new Date().toISOString();

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,"0")).join("");
}

function coordinate(hash) {
  return {
    x: BigInt("0x" + hash.slice(0,16)).toString(),
    y: BigInt("0x" + hash.slice(16,32)).toString(),
    z: BigInt("0x" + hash.slice(32,48)).toString()
  };
}

function authorized(request, env) {
  return !env.OMEGA_NETWORK_KEY ||
    request.headers.get("X-Omega-Key") === env.OMEGA_NETWORK_KEY;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null,{headers:CORS});
    if (!authorized(request,env)) return json({ok:false,error:"unauthorized"},401);

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        return json({ok:true,service:"JSL Omega Network",protocol:"JOFP/1.0",time:now()});
      }

      if (path === "/register" && request.method === "POST") {
        const body = await request.json();
        const deviceName = String(body.device_name || "").trim();
        const deviceType = String(body.device_type || "unknown").trim();
        let nodeId = String(body.node_id || "").trim();

        if (!deviceName) return json({ok:false,error:"device_name_required"},400);
        if (!nodeId) nodeId = crypto.randomUUID();

        const omegaId = await sha256(`JOFP/1.0|NODE|${nodeId}|${deviceName}|${deviceType}`);
        const c = coordinate(omegaId);
        const t = now();

        await env.DB.prepare(`
          INSERT INTO omega_nodes(node_id,device_name,device_type,omega_id,x,y,z,status,created_at,last_seen)
          VALUES(?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(node_id) DO UPDATE SET
            device_name=excluded.device_name,
            device_type=excluded.device_type,
            omega_id=excluded.omega_id,
            x=excluded.x,y=excluded.y,z=excluded.z,
            status='ONLINE',
            last_seen=excluded.last_seen
        `).bind(nodeId,deviceName,deviceType,omegaId,c.x,c.y,c.z,"ONLINE",t,t).run();

        return json({ok:true,node:{node_id:nodeId,device_name:deviceName,device_type:deviceType,omega_id:omegaId,...c,status:"ONLINE",last_seen:t}});
      }

      if (path === "/heartbeat" && request.method === "POST") {
        const body = await request.json();
        await env.DB.prepare("UPDATE omega_nodes SET last_seen=?, status='ONLINE' WHERE node_id=?")
          .bind(now(),String(body.node_id || "")).run();
        return json({ok:true});
      }

      if (path === "/nodes" && request.method === "GET") {
        const rows = await env.DB.prepare(`
          SELECT node_id,device_name,device_type,omega_id,x,y,z,status,last_seen
          FROM omega_nodes ORDER BY last_seen DESC LIMIT 200
        `).all();
        return json({ok:true,nodes:rows.results});
      }

      if (path === "/pair" && request.method === "POST") {
        const body = await request.json();
        const a = String(body.node_a || "");
        const b = String(body.node_b || "");
        if (!a || !b || a === b) return json({ok:false,error:"two_distinct_nodes_required"},400);

        const pairId = await sha256([a,b].sort().join("|"));
        const t = now();
        await env.DB.prepare(`
          INSERT INTO omega_pairs(pair_id,node_a,node_b,state,created_at)
          VALUES(?,?,?,?,?)
          ON CONFLICT(pair_id) DO UPDATE SET state='ACTIVE'
        `).bind(pairId,a,b,"ACTIVE",t).run();

        return json({ok:true,pair:{pair_id:pairId,node_a:a,node_b:b,state:"ACTIVE",created_at:t}});
      }

      if (path === "/send" && request.method === "POST") {
        const body = await request.json();
        const fromNode = String(body.from_node || "");
        const toNode = String(body.to_node || "");
        const payload = String(body.payload || "");
        if (!fromNode || !toNode || !payload) return json({ok:false,error:"from_to_payload_required"},400);

        const messageId = crypto.randomUUID();
        const omegaId = await sha256(`JOFP/1.0|MESSAGE|${messageId}|${fromNode}|${toNode}|${payload}`);
        const t = now();
        await env.DB.prepare(`
          INSERT INTO omega_messages(message_id,from_node,to_node,omega_id,payload,created_at)
          VALUES(?,?,?,?,?,?)
        `).bind(messageId,fromNode,toNode,omegaId,payload,t).run();

        return json({ok:true,message:{message_id:messageId,from_node:fromNode,to_node:toNode,omega_id:omegaId,payload,created_at:t}});
      }

      if (path === "/receive" && request.method === "GET") {
        const nodeId = String(url.searchParams.get("node_id") || "");
        const rows = await env.DB.prepare(`
          SELECT message_id,from_node,to_node,omega_id,payload,created_at,delivered_at
          FROM omega_messages WHERE to_node=? AND delivered_at IS NULL
          ORDER BY created_at DESC LIMIT 100
        `).bind(nodeId).all();
        return json({ok:true,messages:rows.results});
      }

      if (path === "/delivered" && request.method === "POST") {
        const body = await request.json();
        await env.DB.prepare("UPDATE omega_messages SET delivered_at=? WHERE message_id=?")
          .bind(now(),String(body.message_id || "")).run();
        return json({ok:true});
      }

      if (path === "/field" && request.method === "GET") {
        const [n,p,m] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS c FROM omega_nodes").first(),
          env.DB.prepare("SELECT COUNT(*) AS c FROM omega_pairs").first(),
          env.DB.prepare("SELECT COUNT(*) AS c FROM omega_messages").first()
        ]);
        return json({ok:true,field:{nodes:n.c,pairs:p.c,messages:m.c,omega:"Ω0",protocol:"JOFP/1.0"}});
      }

      return json({ok:false,error:"not_found"},404);
    } catch (error) {
      return json({ok:false,error:error.message},500);
    }
  }
};
