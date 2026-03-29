import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const TOTAL_DAYS = 90;
const START_DATE = "2026-03-30";
const FIELDS = ["water", "protein", "green", "red"];
const FIELD_META = {
  water:   { icon: "💧", label: "Water" },
  protein: { icon: "🥩", label: "Protein" },
  green:   { icon: "🟢", label: "Green Ring" },
  red:     { icon: "🔴", label: "Red Ring" },
};
const MAX_PER_PERSON = TOTAL_DAYS * 4;
const COLORS = ["#c04a4c","#FCC728","#4ab0f5","#4caf50","#b57bee","#f0944d","#e55fa3","#5ececa"];
const BUYIN = 20;
const VENMO = "@Kassidee-McDonald";
const VENMO_URL = "https://venmo.com/Kassidee-McDonald";

const AI_PROMPT = `I want to join a 90-day fitness challenge and need help setting my daily goals. Here's my info:

• Height: [your height]
• Weight: [your current weight]
• Sex: [male / female]
• Activity level: [sedentary / lightly active / moderately active / very active]
• Goal: [lose weight / maintain / build muscle]

Please calculate:
1. My daily protein goal in grams
2. My daily water intake goal in ounces
3. My daily active calorie burn goal (red ring target — minimum 500 calories)

Keep it simple — just give me the three numbers and a one-line explanation of how you got each one.`;

function todayStr() { return new Date().toISOString().split("T")[0]; }
function getDayNumber(dateStr) {
  const diff = Math.floor((new Date(dateStr) - new Date(START_DATE)) / 86400000) + 1;
  return diff >= 1 && diff <= TOTAL_DAYS ? diff : null;
}
function buildDays() {
  const days = []; const start = new Date(START_DATE);
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}
function fmtDate(str) {
  return new Date(str + "T12:00:00").toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
}

export default function App() {
  const [participants, setParticipants] = useState([]);
  const [log, setLog] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  const [addingUser, setAddingUser] = useState(false);
  const [step, setStep] = useState(1);
  const [newName, setNewName] = useState("");
  const [newGoals, setNewGoals] = useState({ water:"", protein:"", red:"" });
  const [logPerson, setLogPerson] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [copied, setCopied] = useState(false);
  const today = todayStr();
  const days = buildDays();
  const hasStarted = today >= START_DATE;
  const currentDayNum = getDayNumber(today);

  // ── Load all data from Supabase ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: lData }] = await Promise.all([
      supabase.from("participants").select("*").order("created_at"),
      supabase.from("daily_log").select("*"),
    ]);

    setParticipants(pData || []);

    // Build log object: log[date][person_id][field] = checked
    const logObj = {};
    (lData || []).forEach(({ person_id, date, field, checked }) => {
      if (!logObj[date]) logObj[date] = {};
      if (!logObj[date][person_id]) logObj[date][person_id] = {};
      logObj[date][person_id][field] = checked;
    });
    setLog(logObj);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const t = setInterval(loadAll, 30000); return () => clearInterval(t); }, [loadAll]);

  const getEntry = (date, personId, field) => log?.[date]?.[personId]?.[field] || false;

  const toggleEntry = async (date, personId, field) => {
    const current = getEntry(date, personId, field);
    const next = !current;
    // Optimistic update
    setLog(prev => {
      const updated = { ...prev };
      if (!updated[date]) updated[date] = {};
      if (!updated[date][personId]) updated[date][personId] = {};
      updated[date][personId][field] = next;
      return updated;
    });
    setSaving(true);
    await supabase.from("daily_log").upsert(
      { person_id: personId, date, field, checked: next },
      { onConflict: "person_id,date,field" }
    );
    setSaving(false);
  };

  const addParticipant = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const id = newName.trim().toLowerCase().replace(/\s+/g,"_") + "_" + Date.now();
    const color = COLORS[participants.length % COLORS.length];
    const { data, error } = await supabase.from("participants").insert([{
      id, name: newName.trim(), color,
      goals: {
        water: parseInt(newGoals.water) || 80,
        protein: parseInt(newGoals.protein) || 130,
        red: parseInt(newGoals.red) || 500,
      }
    }]).select().single();
    if (!error && data) setParticipants(prev => [...prev, data]);
    setNewName(""); setNewGoals({ water:"", protein:"", red:"" });
    setAddingUser(false); setStep(1); setSaving(false);
  };

  const removeParticipant = async (id) => {
    setSaving(true);
    await supabase.from("participants").delete().eq("id", id);
    setParticipants(prev => prev.filter(p => p.id !== id));
    setSaving(false);
  };

  const calcPoints = (personId) => {
    let pts = 0;
    Object.values(log).forEach(dayLog => {
      const p = dayLog?.[personId]; if (!p) return;
      FIELDS.forEach(f => { if (p[f]) pts++; });
    });
    return pts;
  };

  const sorted = [...participants].sort((a,b) => calcPoints(b.id) - calcPoints(a.id));
  const pot = participants.length * BUYIN;
  const first = Math.floor(pot * 0.7);
  const second = Math.floor(pot * 0.3);

  const copyPrompt = () => {
    navigator.clipboard.writeText(AI_PROMPT).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div style={{ minHeight:"100vh", background:"#080810", color:"#fff", fontFamily:"Georgia,serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .tf{font-family:'Bebas Neue',sans-serif;}
        .sf{font-family:'DM Serif Display',serif;}
        .df{font-family:'DM Sans',sans-serif;}
        body{background:#080810;}

        .hero{
          background:radial-gradient(ellipse at 70% -10%,#7D3031 0%,transparent 52%),
                     radial-gradient(ellipse at -5% 100%,#FCC728 0%,transparent 48%),#080810;
          padding:38px 22px 28px;text-align:center;
          border-bottom:1px solid rgba(255,255,255,0.05);position:relative;overflow:hidden;
        }
        .hero::before{
          content:'';position:absolute;inset:0;pointer-events:none;
          background:repeating-linear-gradient(90deg,transparent,transparent 58px,rgba(255,255,255,0.01) 58px,rgba(255,255,255,0.01) 59px),
                     repeating-linear-gradient(0deg,transparent,transparent 58px,rgba(255,255,255,0.008) 58px,rgba(255,255,255,0.008) 59px);
        }
        .tabs{display:flex;background:#0c0c16;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto;}
        .tab{
          flex:1;min-width:52px;padding:13px 4px;text-align:center;cursor:pointer;border:none;background:none;
          font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;letter-spacing:1.1px;
          text-transform:uppercase;color:rgba(255,255,255,0.28);border-bottom:2px solid transparent;transition:all 0.2s;white-space:nowrap;
        }
        .tab.on{color:#FCC728;border-bottom:2px solid #FCC728;}
        .tab:hover{color:rgba(255,255,255,0.55);}
        .card{background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px;margin:10px 12px;}
        .bar-bg{height:7px;background:rgba(255,255,255,0.07);border-radius:99px;margin-top:10px;overflow:hidden;}
        .bar-fill{height:100%;border-radius:99px;transition:width 0.7s ease;}
        .cbtn{
          width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,0.1);
          background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;
          font-size:15px;transition:all 0.15s;flex-shrink:0;
        }
        .cbtn.cw{background:#1a3d5c;border-color:#4ab0f5;}
        .cbtn.cp{background:#3d1a1a;border-color:#e55;}
        .cbtn.cg{background:#1a3d1a;border-color:#4caf50;}
        .cbtn.cr{background:#3d1a1a;border-color:#c04a4c;}
        .cbtn:hover:not(:disabled){border-color:rgba(255,255,255,0.4);}
        .cbtn:disabled{cursor:not-allowed;opacity:0.3;}
        .day-row{display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.1s;}
        .day-row:hover{background:rgba(255,255,255,0.018);}
        .day-row.tr{background:rgba(252,199,40,0.04);border-left:3px solid #FCC728;padding-left:9px;}
        .badge{display:inline-block;background:rgba(252,199,40,0.1);color:#FCC728;border:1px solid rgba(252,199,40,0.22);border-radius:99px;padding:3px 12px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;}
        .note{font-family:'DM Sans',sans-serif;font-size:11px;color:rgba(255,255,255,0.27);}
        .inp{width:100%;background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.11);border-radius:10px;padding:12px 14px;color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;transition:border 0.2s;}
        .inp:focus{border-color:rgba(252,199,40,0.45);}
        .inp::placeholder{color:rgba(255,255,255,0.22);}
        .btn-gold{background:linear-gradient(135deg,#b8920a,#FCC728);border:none;padding:14px 28px;border-radius:99px;font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:#0a0a0f;cursor:pointer;transition:transform 0.15s,opacity 0.15s;width:100%;}
        .btn-gold:hover:not(:disabled){transform:scale(1.02);}
        .btn-gold:disabled{opacity:0.4;cursor:not-allowed;}
        .btn-ghost{background:transparent;border:1px solid rgba(255,255,255,0.13);padding:12px 28px;border-radius:99px;font-family:'DM Sans',sans-serif;font-size:14px;color:rgba(255,255,255,0.45);cursor:pointer;width:100%;transition:all 0.15s;}
        .btn-ghost:hover{border-color:rgba(255,255,255,0.28);color:rgba(255,255,255,0.75);}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;display:flex;align-items:flex-end;justify-content:center;}
        .modal{background:#12121c;border-radius:20px 20px 0 0;padding:28px 22px 44px;width:100%;max-width:480px;border-top:1px solid rgba(255,255,255,0.09);}
        .goal-inp{background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.11);border-radius:10px;padding:11px 14px;color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;width:100%;}
        .goal-inp:focus{border-color:rgba(252,199,40,0.4);}
        .goal-inp::placeholder{color:rgba(255,255,255,0.2);}
        .sync-bar{display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;background:rgba(255,255,255,0.02);font-family:'DM Sans',sans-serif;font-size:10px;color:rgba(255,255,255,0.2);border-bottom:1px solid rgba(255,255,255,0.04);}
        .dot{width:6px;height:6px;border-radius:50%;background:#4caf50;}
        .saving-dot{background:#FCC728;animation:pulse 0.8s infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        .spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.1);border-top-color:#FCC728;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .prize-box{border-radius:14px;padding:20px;margin-bottom:12px;}
        .prize-1{background:linear-gradient(135deg,rgba(252,199,40,0.12),rgba(252,199,40,0.04));border:1px solid rgba(252,199,40,0.25);}
        .prize-2{background:linear-gradient(135deg,rgba(192,192,192,0.1),rgba(192,192,192,0.03));border:1px solid rgba(192,192,192,0.18);}
        .venmo-box{background:rgba(0,130,242,0.12);border:1px solid rgba(0,130,242,0.25);border-radius:14px;padding:18px;margin-bottom:12px;text-align:center;cursor:pointer;transition:background 0.15s;text-decoration:none;display:block;}
        .venmo-box:hover{background:rgba(0,130,242,0.22);}
        .prompt-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(255,255,255,0.5);line-height:1.7;white-space:pre-wrap;word-break:break-word;}
        .copy-btn{background:rgba(252,199,40,0.12);border:1px solid rgba(252,199,40,0.3);color:#FCC728;border-radius:99px;padding:8px 20px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;letter-spacing:0.5px;}
        .copy-btn:hover{background:rgba(252,199,40,0.2);}
        .copy-btn.done{background:rgba(76,175,80,0.2);border-color:rgba(76,175,80,0.4);color:#4caf50;}
        .info-divider{height:1px;background:rgba(255,255,255,0.05);margin:20px 0;}
        .pill-btn{padding:6px 14px;border-radius:99px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all 0.15s;}
      `}</style>

      {/* HERO */}
      <div className="hero">
        <div style={{position:"relative",zIndex:1}}>
          <div className="tf" style={{fontSize:10,letterSpacing:6,color:"#FCC728",marginBottom:8,opacity:0.8}}>SUMMER 2026</div>
          <div className="tf" style={{fontSize:52,lineHeight:0.88,color:"#fff",marginBottom:2}}>90 DAY</div>
          <div className="tf" style={{fontSize:52,lineHeight:0.88,color:"#FCC728"}}>SUMMER STRONG</div>
          <div className="sf" style={{fontSize:15,fontStyle:"italic",color:"rgba(255,255,255,0.38)",marginTop:10}}>Challenge</div>
          <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {hasStarted && currentDayNum
              ? <span className="badge">Day {currentDayNum} of 90 🔥</span>
              : <span className="badge">Starts {fmtDate(START_DATE)}</span>}
            {participants.length > 0 && (
              <span className="badge" style={{background:"rgba(255,255,255,0.04)",borderColor:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"}}>
                {participants.length} player{participants.length!==1?"s":""} · ${pot} pot
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SYNC BAR */}
      <div className="sync-bar">
        <div className={`dot ${saving?"saving-dot":""}`}/>
        <span>{saving?"Saving…":lastSync?`Live · synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Connecting…"}</span>
        <button onClick={loadAll} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",cursor:"pointer",fontSize:10,fontFamily:"DM Sans",marginLeft:4,textDecoration:"underline"}}>Refresh</button>
      </div>

      {/* TABS */}
      <div className="tabs">
        {[["info","ℹ️ Info"],["board","🏆 Board"],["log","📋 Log"],["rules","📖 Rules"],["manage","⚙️ Players"]].map(([id,label])=>(
          <button key={id} className={`tab ${activeTab===id?"on":""}`} onClick={()=>setActiveTab(id)}>{label}</button>
        ))}
      </div>

      {loading?(
        <div style={{padding:60,textAlign:"center"}}><div className="spinner"/><div className="note" style={{marginTop:14}}>Loading…</div></div>
      ):(
        <>
          {/* ── INFO ── */}
          {activeTab==="info"&&(
            <div style={{padding:"22px 14px 80px"}}>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:4}}>WHAT IS THIS?</div>
                <div className="df" style={{fontSize:14,color:"rgba(255,255,255,0.6)",lineHeight:1.75}}>
                  The <strong style={{color:"#FCC728"}}>90 Day Summer Strong Challenge</strong> is a friendly fitness competition running from <strong style={{color:"#fff"}}>{fmtDate(START_DATE)}</strong> to <strong style={{color:"#fff"}}>{fmtDate("2026-06-27")}</strong>.{"\n\n"}Every day you can earn up to <strong style={{color:"#FCC728"}}>4 points</strong> by hitting your personal health goals. The player with the most points after 90 days wins the pot.
                </div>
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:12}}>DAILY POINT GOALS</div>
                {[
                  {icon:"💧",label:"Water",desc:"Hit your personal daily oz goal"},
                  {icon:"🥩",label:"Protein",desc:"Hit your personal daily gram goal"},
                  {icon:"🟢",label:"Green Ring",desc:"30 minutes of exercise"},
                  {icon:"🔴",label:"Red Ring",desc:"Hit your personal active calorie goal (min 500 cal)"},
                ].map(({icon,label,desc})=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <span style={{fontSize:22,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1}}>
                      <div className="tf" style={{fontSize:17,letterSpacing:0.5}}>{label}</div>
                      <div className="note" style={{fontSize:12}}>{desc}</div>
                    </div>
                    <div className="tf" style={{fontSize:20,color:"#FCC728"}}>1 PT</div>
                  </div>
                ))}
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:4}}>PRIZES</div>
                <div className="note" style={{marginBottom:12,fontSize:12}}>Based on {participants.length} player{participants.length!==1?"s":""} · ${pot} total pot</div>
                <div className="prize-box prize-1">
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <span style={{fontSize:26}}>🥇</span>
                    <div className="tf" style={{fontSize:24,color:"#FCC728",letterSpacing:1}}>1ST PLACE</div>
                  </div>
                  <div className="tf" style={{fontSize:42,color:"#FCC728",lineHeight:1}}>${first}</div>
                  <div className="note" style={{marginTop:4}}>70% of the pot · grows as more players join</div>
                </div>
                <div className="prize-box prize-2">
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <span style={{fontSize:22}}>🥈</span>
                    <div className="tf" style={{fontSize:20,color:"rgba(200,200,200,0.8)",letterSpacing:1}}>2ND PLACE</div>
                  </div>
                  <div className="tf" style={{fontSize:36,color:"rgba(200,200,200,0.7)",lineHeight:1}}>${second}</div>
                  <div className="note" style={{marginTop:4}}>30% of the pot · grows as more players join</div>
                </div>
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:12}}>BUY IN</div>
                <a href={VENMO_URL} target="_blank" rel="noopener noreferrer" className="venmo-box">
                  <div style={{fontSize:32,marginBottom:4}}>💙</div>
                  <div className="tf" style={{fontSize:32,letterSpacing:1,color:"#4ab0f5"}}>$20 VENMO</div>
                  <div className="df" style={{fontSize:20,fontWeight:600,color:"#fff",marginTop:6,marginBottom:4}}>{VENMO}</div>
                  <div className="note" style={{fontSize:12}}>Tap to open Venmo · Send $20 to lock in your spot</div>
                  <div className="df" style={{fontSize:11,color:"rgba(255,255,255,0.2)",marginTop:6}}>Note: "Summer Strong Challenge"</div>
                </a>
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:4}}>FIND YOUR GOALS</div>
                <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginBottom:14,lineHeight:1.6}}>
                  Everyone's protein, water, and red ring targets are personalized. Copy this prompt into Claude or ChatGPT to calculate yours, then enter them when you join.
                </div>
                <div className="prompt-box">{AI_PROMPT}</div>
                <div style={{textAlign:"center",marginTop:12}}>
                  <button className={`copy-btn ${copied?"done":""}`} onClick={copyPrompt}>
                    {copied?"✓ Copied!":"Copy Prompt"}
                  </button>
                </div>
              </div>
              <div className="info-divider"/>
              <button className="btn-gold" onClick={()=>{setActiveTab("manage");setAddingUser(true);}}>
                JOIN THE CHALLENGE 🔥
              </button>
              <div className="note" style={{textAlign:"center",marginTop:10}}>After joining, send $20 to {VENMO} on Venmo.</div>
            </div>
          )}

          {/* ── BOARD ── */}
          {activeTab==="board"&&(
            <div style={{paddingBottom:80}}>
              {participants.length===0?(
                <div style={{textAlign:"center",padding:"60px 24px"}}>
                  <div className="sf" style={{fontSize:24,color:"rgba(255,255,255,0.5)",marginBottom:8}}>No players yet!</div>
                  <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.3)",marginBottom:24}}>Check the Info tab to get started.</div>
                  <button className="btn-gold" style={{width:"auto",padding:"14px 32px"}} onClick={()=>setActiveTab("info")}>SEE INFO →</button>
                </div>
              ):(
                <>
                  <div style={{display:"flex",gap:8,padding:"10px 12px 0",justifyContent:"center"}}>
                    {[["🥇","1st Place",first,"rgba(252,199,40,0.08)","rgba(252,199,40,0.18)","#FCC728"],
                      ["🥈","2nd Place",second,"rgba(192,192,192,0.06)","rgba(192,192,192,0.14)","rgba(200,200,200,0.7)"],
                      ["💰","Pot",pot,"rgba(255,255,255,0.03)","rgba(255,255,255,0.07)","rgba(255,255,255,0.6)"]
                    ].map(([icon,label,val,bg,border,color])=>(
                      <div key={label} style={{flex:1,background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                        <div className="note" style={{marginBottom:2}}>{icon} {label}</div>
                        <div className="tf" style={{fontSize:20,color}}>${val}</div>
                      </div>
                    ))}
                  </div>
                  {sorted.map((p,i)=>{
                    const pts=calcPoints(p.id);
                    const pct=Math.round((pts/MAX_PER_PERSON)*100);
                    const todayPts=FIELDS.filter(f=>getEntry(today,p.id,f)).length;
                    return(
                      <div key={p.id} className="card" style={{borderTop:`3px solid ${p.color}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                            <div className="tf" style={{fontSize:34,lineHeight:1,color:i===0?"#FCC728":i===1?"rgba(200,200,200,0.5)":"rgba(255,255,255,0.12)",marginTop:2}}>#{i+1}</div>
                            <div>
                              <div className="tf" style={{fontSize:26,letterSpacing:0.8,color:"#fff"}}>{p.name}</div>
                              <div className="note">{p.goals.protein}g · {p.goals.water}oz · {p.goals.red}cal</div>
                              {hasStarted&&(
                                <div style={{marginTop:4,display:"flex",gap:4,alignItems:"center"}}>
                                  {FIELDS.map(f=><span key={f} style={{fontSize:13,opacity:getEntry(today,p.id,f)?1:0.18}}>{FIELD_META[f].icon}</span>)}
                                  <span className="note" style={{marginLeft:4,fontSize:10}}>{todayPts}/4 today</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div className="tf" style={{fontSize:44,lineHeight:1,color:p.color}}>{pts}</div>
                            <div className="note">/ {MAX_PER_PERSON}</div>
                          </div>
                        </div>
                        <div className="bar-bg"><div className="bar-fill" style={{width:`${pct}%`,background:`linear-gradient(90deg,${p.color}77,${p.color})`}}/></div>
                        <div className="note" style={{marginTop:5}}>{pct}% complete</div>
                      </div>
                    );
                  })}
                  <div style={{margin:"6px 12px 0"}}>
                    <div className="df" style={{fontSize:10,letterSpacing:2.5,textTransform:"uppercase",color:"rgba(255,255,255,0.18)",marginBottom:10,paddingLeft:2}}>
                      {hasStarted&&currentDayNum?`Log Today — Day ${currentDayNum}`:`Starts ${fmtDate(START_DATE)}`}
                    </div>
                    <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(252,199,40,0.1)",borderRadius:12,padding:"14px"}}>
                      {participants.map(p=>(
                        <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                          <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                          <span className="df" style={{fontSize:13,color:"rgba(255,255,255,0.5)",width:80,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                          <div style={{display:"flex",gap:6}}>
                            {FIELDS.map(f=><CB key={f} field={f} checked={getEntry(today,p.id,f)} disabled={!hasStarted||saving} onClick={()=>toggleEntry(today,p.id,f)}/>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── LOG ── */}
          {activeTab==="log"&&(
            <div style={{paddingBottom:80}}>
              {participants.length===0?(
                <div style={{textAlign:"center",padding:"60px 24px",color:"rgba(255,255,255,0.3)"}} className="df">No players yet.</div>
              ):(
                <>
                  <div style={{display:"flex",gap:7,padding:"12px 12px 6px",overflowX:"auto",flexWrap:"nowrap"}}>
                    <button className="pill-btn" onClick={()=>setLogPerson(null)}
                      style={{border:`1.5px solid ${logPerson===null?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.1)"}`,background:logPerson===null?"rgba(255,255,255,0.08)":"transparent",color:logPerson===null?"#fff":"rgba(255,255,255,0.4)"}}>All</button>
                    {participants.map(p=>(
                      <button key={p.id} className="pill-btn" onClick={()=>setLogPerson(logPerson===p.id?null:p.id)}
                        style={{border:`1.5px solid ${logPerson===p.id?p.color:"rgba(255,255,255,0.1)"}`,background:logPerson===p.id?`${p.color}22`:"transparent",color:logPerson===p.id?p.color:"rgba(255,255,255,0.4)"}}>{p.name}</button>
                    ))}
                  </div>
                  <div className="note" style={{padding:"0 12px 8px",fontSize:10}}>💧 water · 🥩 protein · 🟢 green · 🔴 red</div>
                  {days.map((date,i)=>{
                    const isToday=date===today,isFuture=date>today;
                    const activePlayers=logPerson?participants.filter(p=>p.id===logPerson):participants;
                    return(
                      <div key={date} className={`day-row${isToday?" tr":""}`} style={{opacity:isFuture?0.25:1}}>
                        <div className="tf" style={{fontSize:17,color:isToday?"#FCC728":"rgba(255,255,255,0.16)",width:28,flexShrink:0,textAlign:"center"}}>{i+1}</div>
                        <div style={{display:"flex",gap:10,overflowX:"auto",flex:1,alignItems:"center"}}>
                          {activePlayers.map(p=>(
                            <div key={p.id} style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
                              <div style={{width:5,height:5,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                              {FIELDS.map(f=><CB key={f} field={f} checked={getEntry(date,p.id,f)} disabled={isFuture||saving} onClick={()=>!isFuture&&toggleEntry(date,p.id,f)}/>)}
                            </div>
                          ))}
                        </div>
                        {isToday&&<span style={{fontSize:9,color:"#FCC728",fontFamily:"DM Sans",flexShrink:0,letterSpacing:1}}>TODAY</span>}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── RULES ── */}
          {activeTab==="rules"&&(
            <div style={{padding:"22px 18px 80px"}}>
              <div className="tf" style={{fontSize:30,letterSpacing:1,marginBottom:18}}>CHALLENGE RULES</div>
              {[
                {icon:"💧",title:"Water",body:"Hit your personal daily oz goal = 1 point."},
                {icon:"🥩",title:"Protein",body:"Hit your personal daily gram goal = 1 point."},
                {icon:"🟢",title:"Green Ring",body:"30 minutes of exercise = 1 point. Everyone."},
                {icon:"🔴",title:"Red Ring",body:"Hit your personal active calorie goal\n(minimum 500 cal) = 1 point."},
                {icon:"🏆",title:"Scoring",body:"Max 4 points per day.\n360 points over 90 days.\nHighest score wins."},
                {icon:"💰",title:"Buy In",body:`$20 via Venmo to ${VENMO}\nSend before the start date to lock in your spot.`},
                {icon:"🥇",title:"Prizes",body:"1st place: 70% of the pot\n2nd place: 30% of the pot"},
                {icon:"📅",title:"Duration",body:`${fmtDate(START_DATE)} → ${fmtDate("2026-06-27")}`},
                {icon:"🌐",title:"Tracking",body:"This scoreboard is live and shared.\nEveryone logs their own points in real time from any device."},
              ].map(({icon,title,body})=>(
                <div key={title} style={{marginBottom:16,borderBottom:"1px solid rgba(255,255,255,0.05)",paddingBottom:16}}>
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    <span style={{fontSize:22,flexShrink:0}}>{icon}</span>
                    <div>
                      <div className="tf" style={{fontSize:19,letterSpacing:1,marginBottom:3}}>{title}</div>
                      <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.5)",lineHeight:1.6,whiteSpace:"pre-line"}}>{body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── MANAGE ── */}
          {activeTab==="manage"&&(
            <div style={{padding:"16px 12px 80px"}}>
              <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:14}}>PLAYERS</div>
              {participants.length===0&&<div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.3)",marginBottom:18}}>No one has joined yet. Be first!</div>}
              {participants.map(p=>{
                const pts=calcPoints(p.id);
                return(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"13px 14px",marginBottom:9}}>
                    <div style={{width:9,height:9,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="tf" style={{fontSize:20,letterSpacing:0.5}}>{p.name}</div>
                      <div className="note">{p.goals.protein}g · {p.goals.water}oz · {p.goals.red}cal · <span style={{color:p.color}}>{pts} pts</span></div>
                    </div>
                    <button onClick={()=>removeParticipant(p.id)} disabled={saving} style={{background:"none",border:"1px solid rgba(255,255,255,0.09)",color:"rgba(255,255,255,0.28)",borderRadius:8,padding:"5px 11px",cursor:"pointer",fontFamily:"DM Sans",fontSize:11,flexShrink:0}}>Remove</button>
                  </div>
                );
              })}
              <button className="btn-gold" style={{marginTop:10}} onClick={()=>setAddingUser(true)} disabled={saving}>+ JOIN THE CHALLENGE</button>
              <div className="note" style={{textAlign:"center",marginTop:10}}>After joining, send $20 to {VENMO} on Venmo.</div>
            </div>
          )}
        </>
      )}

      {/* ── ADD PLAYER MODAL ── */}
      {addingUser&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget){setAddingUser(false);setStep(1);setNewName("");}}}>
          <div className="modal">
            {step===1&&(
              <>
                <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:4}}>JOIN THE CHALLENGE</div>
                <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginBottom:22}}>Step 1 of 2 — What's your name?</div>
                <input className="inp" placeholder="Your name" value={newName} autoFocus
                  onChange={e=>setNewName(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newName.trim())setStep(2);}}/>
                <div style={{display:"flex",gap:10,marginTop:16}}>
                  <button className="btn-ghost" onClick={()=>{setAddingUser(false);setStep(1);setNewName("");}}>Cancel</button>
                  <button className="btn-gold" onClick={()=>{if(newName.trim())setStep(2);}} disabled={!newName.trim()}>NEXT →</button>
                </div>
              </>
            )}
            {step===2&&(
              <>
                <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:4}}>HEY {newName.toUpperCase()}! 👋</div>
                <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginBottom:20}}>Step 2 of 2 — Set your daily goals</div>
                {[
                  {key:"water",icon:"💧",label:"Water goal (oz)",ph:"e.g. 84",hint:"Min 80oz"},
                  {key:"protein",icon:"🥩",label:"Protein goal (grams)",ph:"e.g. 130",hint:"Use AI prompt on Info tab"},
                  {key:"red",icon:"🔴",label:"Red ring goal (calories)",ph:"e.g. 500",hint:"Min 500 active calories"},
                ].map(({key,icon,label,ph,hint})=>(
                  <div key={key} style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:14}}>
                    <span style={{fontSize:22,flexShrink:0,marginTop:8}}>{icon}</span>
                    <div style={{flex:1}}>
                      <div className="df" style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:5}}>{label}</div>
                      <input className="goal-inp" type="number" placeholder={ph} value={newGoals[key]} onChange={e=>setNewGoals(g=>({...g,[key]:e.target.value}))}/>
                      <div className="note" style={{marginTop:3}}>{hint}</div>
                    </div>
                  </div>
                ))}
                <div className="note" style={{marginBottom:16,lineHeight:1.6}}>🟢 Green ring is fixed for everyone: 30 min exercise.</div>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn-ghost" onClick={()=>setStep(1)}>← Back</button>
                  <button className="btn-gold" onClick={addParticipant} disabled={saving}>{saving?"Saving…":"JOIN 🔥"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CB({field,checked,onClick,disabled}){
  const map={water:"cw",protein:"cp",green:"cg",red:"cr"};
  const icons={water:"💧",protein:"🥩",green:"🟢",red:"🔴"};
  return(
    <button className={`cbtn ${checked?map[field]:""}`} onClick={onClick} disabled={disabled}>
      {checked?icons[field]:<span style={{fontSize:10,color:"rgba(255,255,255,0.12)"}}>·</span>}
    </button>
  );
}
