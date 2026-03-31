import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

const TOTAL_DAYS = 90;
const START_DATE = "2026-03-30";
const MAX_PER_PERSON = TOTAL_DAYS * 4;
const COLORS = ["#c04a4c","#FCC728","#4ab0f5","#4caf50","#b57bee","#f0944d","#e55fa3","#5ececa"];
const BUYIN = 20;
const VENMO = "@Kassidee-McDonald";
const VENMO_URL = "https://venmo.com/Kassidee-McDonald";

// Signup closes at 11:59 PM Pacific Daylight Time on March 30, 2026
// 11:59 PM PDT = 06:59 UTC March 31
const SIGNUP_CUTOFF = new Date("2026-03-31T06:59:00Z");
function signupOpen() { return new Date() < SIGNUP_CUTOFF; }

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

// Get today's date in Pacific Time
function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
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
function fmtShort(str) {
  return new Date(str + "T12:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric" });
}
function goalsHit(input, goals) {
  if (!input) return { water:false, protein:false, green:false, red:false };
  return {
    water:    (input.water_oz    || 0) >= (goals.water   || 0),
    protein:  (input.protein_g   || 0) >= (goals.protein || 0),
    green:    (input.exercise_min|| 0) >= 30,
    red:      (input.calories    || 0) >= (goals.red     || 500),
  };
}
function countHit(input, goals) {
  return Object.values(goalsHit(input, goals)).filter(Boolean).length;
}

export default function App() {
  const [participants, setParticipants] = useState([]);
  const [inputs, setInputs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  const [addingUser, setAddingUser] = useState(false);
  const [step, setStep] = useState(1);
  const [newName, setNewName] = useState("");
  const [newGoals, setNewGoals] = useState({ water:"", protein:"", red:"" });
  const [lastSync, setLastSync] = useState(null);
  const [copied, setCopied] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [activeDayLog, setActiveDayLog] = useState(null); // date string being logged
  const [draftInputs, setDraftInputs] = useState({});
  const [activeUser, setActiveUser] = useState(() => localStorage.getItem("ss-active-user") || null);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const celebTimerRef = useRef(null);
  const today = todayStr();
  const days = buildDays();
  const hasStarted = today >= START_DATE;
  const currentDayNum = getDayNumber(today);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: iData }] = await Promise.all([
      supabase.from("participants").select("*").order("created_at"),
      supabase.from("daily_inputs").select("*"),
    ]);
    setParticipants(pData || []);
    const inp = {};
    (iData || []).forEach(row => {
      if (!inp[row.date]) inp[row.date] = {};
      inp[row.date][row.person_id] = row;
    });
    setInputs(inp);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const t = setInterval(loadAll, 30000); return () => clearInterval(t); }, [loadAll]);

  const setUser = (id) => {
    setActiveUser(id);
    localStorage.setItem("ss-active-user", id);
    setShowUserPicker(false);
  };

  const getInput = (date, personId) => inputs?.[date]?.[personId] || null;

  const calcPoints = (personId) => {
    const p = participants.find(x => x.id === personId);
    if (!p) return 0;
    let pts = 0;
    Object.values(inputs).forEach(dayInputs => {
      pts += countHit(dayInputs?.[personId], p.goals);
    });
    return pts;
  };

  // Best streak for a person
  const calcStreak = (personId) => {
    const p = participants.find(x => x.id === personId);
    if (!p) return 0;
    let streak = 0;
    const pastDays = days.filter(d => d <= today);
    for (let i = pastDays.length - 1; i >= 0; i--) {
      const inp = getInput(pastDays[i], personId);
      if (countHit(inp, p.goals) > 0) streak++;
      else break;
    }
    return streak;
  };

  const triggerCelebration = (type, label) => {
    if (celebTimerRef.current) clearTimeout(celebTimerRef.current);
    setCelebration({ type, label });
    celebTimerRef.current = setTimeout(() => setCelebration(null), type === 'all4' ? 3500 : 2000);
  };

  const openDayLog = (date) => {
    const existing = getInput(date, activeUser) || {};
    setDraftInputs({
      water_oz: existing.water_oz || "",
      protein_g: existing.protein_g || "",
      exercise_min: existing.exercise_min || "",
      calories: existing.calories || "",
    });
    setActiveDayLog(date);
  };

  const saveDayLog = async () => {
    const p = participants.find(x => x.id === activeUser);
    if (!p || !activeDayLog) return;
    setSaving(true);
    const row = {
      person_id: activeUser, date: activeDayLog,
      water_oz: parseFloat(draftInputs.water_oz) || 0,
      protein_g: parseFloat(draftInputs.protein_g) || 0,
      exercise_min: parseFloat(draftInputs.exercise_min) || 0,
      calories: parseFloat(draftInputs.calories) || 0,
    };
    await supabase.from("daily_inputs").upsert(row, { onConflict: "person_id,date" });
    const prevInp = getInput(activeDayLog, activeUser);
    const prevHit = countHit(prevInp, p.goals);
    const newHit = countHit(row, p.goals);
    const newGoalsObj = goalsHit(row, p.goals);
    const prevGoalsObj = goalsHit(prevInp, p.goals);
    setInputs(prev => {
      const updated = { ...prev };
      if (!updated[activeDayLog]) updated[activeDayLog] = {};
      updated[activeDayLog][activeUser] = row;
      return updated;
    });
    if (activeDayLog === today) {
      if (newHit === 4 && prevHit < 4) {
        triggerCelebration('all4', p.name);
      } else if (newHit > prevHit) {
        const newlyHit = Object.entries(newGoalsObj).find(([k,v]) => v && !prevGoalsObj[k]);
        if (newlyHit) {
          const labels = { water:'💧 Water goal hit!', protein:'🥩 Protein goal hit!', green:'🟢 Green ring hit!', red:'🔴 Red ring hit!' };
          triggerCelebration('single', labels[newlyHit[0]]);
        }
      }
    }
    setSaving(false);
    setActiveDayLog(null);
  };

  const addParticipant = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const id = newName.trim().toLowerCase().replace(/\s+/g,"_") + "_" + Date.now();
    const color = COLORS[participants.length % COLORS.length];
    const { data, error } = await supabase.from("participants").insert([{
      id, name: newName.trim(), color,
      goals: { water: parseInt(newGoals.water)||80, protein: parseInt(newGoals.protein)||130, red: parseInt(newGoals.red)||500 }
    }]).select().single();
    if (!error && data) { setParticipants(prev => [...prev, data]); setUser(data.id); }
    setNewName(""); setNewGoals({ water:"", protein:"", red:"" });
    setAddingUser(false); setStep(1); setSaving(false);
  };

  const removeParticipant = async (id) => {
    setSaving(true);
    await supabase.from("participants").delete().eq("id", id);
    setParticipants(prev => prev.filter(p => p.id !== id));
    if (activeUser === id) { setActiveUser(null); localStorage.removeItem("ss-active-user"); }
    setSaving(false);
  };

  const sorted = [...participants].sort((a,b) => calcPoints(b.id) - calcPoints(a.id));
  const pot = participants.length * BUYIN;
  const first = Math.floor(pot * 0.7);
  const second = Math.floor(pot * 0.3);
  const activeParticipant = participants.find(p => p.id === activeUser);
  const copyPrompt = () => { navigator.clipboard.writeText(AI_PROMPT).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }); };

  // Draft preview for log modal
  const draftPreview = {
    water_oz: parseFloat(draftInputs.water_oz)||0,
    protein_g: parseFloat(draftInputs.protein_g)||0,
    exercise_min: parseFloat(draftInputs.exercise_min)||0,
    calories: parseFloat(draftInputs.calories)||0,
  };
  const draftPerson = participants.find(x => x.id === activeUser);
  const draftHit = draftPerson ? goalsHit(draftPreview, draftPerson.goals) : {};
  const draftCount = draftPerson ? countHit(draftPreview, draftPerson.goals) : 0;

  return (
    <div style={{ minHeight:"100vh", background:"#080810", color:"#fff", fontFamily:"Georgia,serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .tf{font-family:'Bebas Neue',sans-serif;}
        .sf{font-family:'DM Serif Display',serif;}
        .df{font-family:'DM Sans',sans-serif;}
        body{background:#080810;}
        .hero{background:radial-gradient(ellipse at 70% -10%,#7D3031 0%,transparent 52%),radial-gradient(ellipse at -5% 100%,#FCC728 0%,transparent 48%),#080810;padding:38px 22px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);position:relative;overflow:hidden;}
        .hero::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,transparent,transparent 58px,rgba(255,255,255,0.01) 58px,rgba(255,255,255,0.01) 59px);}
        .tabs{display:flex;background:#0c0c16;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto;}
        .tab{flex:1;min-width:52px;padding:13px 4px;text-align:center;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,0.28);border-bottom:2px solid transparent;transition:all 0.2s;white-space:nowrap;}
        .tab.on{color:#FCC728;border-bottom:2px solid #FCC728;}
        .tab:hover{color:rgba(255,255,255,0.55);}
        .badge{display:inline-block;background:rgba(252,199,40,0.1);color:#FCC728;border:1px solid rgba(252,199,40,0.22);border-radius:99px;padding:3px 12px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;}
        .note{font-family:'DM Sans',sans-serif;font-size:11px;color:rgba(255,255,255,0.27);}
        .inp{width:100%;background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.11);border-radius:10px;padding:12px 14px;color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;transition:border 0.2s;}
        .inp:focus{border-color:rgba(252,199,40,0.45);}
        .inp::placeholder{color:rgba(255,255,255,0.22);}
        .num-inp{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;color:#fff;font-family:'DM Sans',sans-serif;font-size:16px;font-weight:500;outline:none;width:100%;transition:border 0.2s;-moz-appearance:textfield;}
        .num-inp::-webkit-inner-spin-button,.num-inp::-webkit-outer-spin-button{-webkit-appearance:none;}
        .num-inp:focus{border-color:rgba(252,199,40,0.5);}
        .num-inp.hit{border-color:rgba(76,175,80,0.6);background:rgba(76,175,80,0.08);}
        .num-inp::placeholder{color:rgba(255,255,255,0.2);}
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
        .saving-dot{background:#FCC728;animation:blink 0.8s infinite;}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0.3;}}
        .spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.1);border-top-color:#FCC728;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .prize-box{border-radius:14px;padding:20px;margin-bottom:12px;}
        .prize-1{background:linear-gradient(135deg,rgba(252,199,40,0.12),rgba(252,199,40,0.04));border:1px solid rgba(252,199,40,0.25);}
        .prize-2{background:linear-gradient(135deg,rgba(192,192,192,0.1),rgba(192,192,192,0.03));border:1px solid rgba(192,192,192,0.18);}
        .venmo-box{background:rgba(0,130,242,0.12);border:1px solid rgba(0,130,242,0.25);border-radius:14px;padding:18px;margin-bottom:12px;text-align:center;cursor:pointer;transition:background 0.15s;text-decoration:none;display:block;}
        .venmo-box:hover{background:rgba(0,130,242,0.22);}
        .prompt-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(255,255,255,0.5);line-height:1.7;white-space:pre-wrap;word-break:break-word;}
        .copy-btn{background:rgba(252,199,40,0.12);border:1px solid rgba(252,199,40,0.3);color:#FCC728;border-radius:99px;padding:8px 20px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;}
        .copy-btn:hover{background:rgba(252,199,40,0.2);}
        .copy-btn.done{background:rgba(76,175,80,0.2);border-color:rgba(76,175,80,0.4);color:#4caf50;}
        .info-divider{height:1px;background:rgba(255,255,255,0.05);margin:20px 0;}
        .who-bar{background:rgba(252,199,40,0.06);border-bottom:1px solid rgba(252,199,40,0.12);padding:10px 14px;display:flex;align-items:center;gap:10px;}
        .who-name{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;color:#FCC728;}
        .who-change{background:none;border:1px solid rgba(252,199,40,0.25);border-radius:99px;padding:4px 12px;font-family:'DM Sans',sans-serif;font-size:11px;color:rgba(252,199,40,0.6);cursor:pointer;}
        .who-change:hover{border-color:rgba(252,199,40,0.5);color:#FCC728;}
        .user-grid{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto;}
        .user-option{display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;transition:all 0.15s;}
        .user-option:hover{border-color:rgba(252,199,40,0.3);background:rgba(252,199,40,0.05);}
        .user-option.selected{border-color:rgba(252,199,40,0.5);background:rgba(252,199,40,0.08);}
        .celeb-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;pointer-events:none;}
        .celeb-single{background:rgba(20,20,30,0.92);border:1px solid rgba(252,199,40,0.3);border-radius:20px;padding:20px 32px;text-align:center;animation:popIn 0.3s ease;}
        .celeb-all4{background:rgba(20,20,30,0.95);border:2px solid #FCC728;border-radius:24px;padding:32px 40px;text-align:center;animation:popIn 0.4s ease;box-shadow:0 0 60px rgba(252,199,40,0.3);}
        @keyframes popIn{0%{transform:scale(0.7);opacity:0;}70%{transform:scale(1.05);}100%{transform:scale(1);opacity:1;}}
        .bounce{animation:bnc 0.5s ease infinite alternate;}
        @keyframes bnc{0%{transform:translateY(0);}100%{transform:translateY(-8px);}}

        /* Leaderboard row */
        .lb-row{display:flex;align-items:center;gap:12px;padding:14px 14px;border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s;}
        .lb-row:hover{background:rgba(255,255,255,0.02);}
        .lb-row.me{background:rgba(252,199,40,0.04);border-left:3px solid #FCC728;padding-left:11px;}
        .lb-rank{font-family:'Bebas Neue',sans-serif;font-size:28px;width:36px;text-align:center;flex-shrink:0;line-height:1;}
        .lb-name{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.5px;color:#fff;line-height:1;margin-bottom:2px;}
        .lb-sub{font-family:'DM Sans',sans-serif;font-size:10px;color:rgba(255,255,255,0.3);}
        .lb-pts{font-family:'Bebas Neue',sans-serif;font-size:36px;line-height:1;text-align:right;flex-shrink:0;}
        .lb-bar-bg{height:3px;background:rgba(255,255,255,0.06);border-radius:99px;margin-top:6px;overflow:hidden;}
        .lb-bar-fill{height:100%;border-radius:99px;transition:width 0.7s ease;}

        /* Today pills on leaderboard */
        .today-pills{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;}
        .today-pill{font-size:10px;padding:2px 7px;border-radius:99px;font-family:'DM Sans',sans-serif;font-weight:500;}
        .today-pill.hit{background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.3);color:#4caf50;}
        .today-pill.miss{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.25);}

        /* Log tab day card */
        .day-card{margin:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;}
        .day-card.today-card{border-color:rgba(252,199,40,0.25);}
        .day-card-header{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;transition:background 0.15s;}
        .day-card-header:hover{background:rgba(255,255,255,0.02);}
        .day-card.today-card .day-card-header{background:rgba(252,199,40,0.04);}
        .day-num-big{font-family:'Bebas Neue',sans-serif;font-size:22px;color:rgba(255,255,255,0.18);width:28px;text-align:center;flex-shrink:0;}
        .day-num-big.td{color:#FCC728;}
        .log-stat{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);}
        .log-stat:last-of-type{border-bottom:none;}
        .log-btn-sm{background:rgba(252,199,40,0.1);border:1px solid rgba(252,199,40,0.2);border-radius:8px;padding:8px 14px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;color:#FCC728;cursor:pointer;transition:all 0.15s;width:100%;}
        .log-btn-sm:hover{background:rgba(252,199,40,0.18);}
      `}</style>

      {/* CELEBRATION */}
      {celebration && (
        <div className="celeb-overlay">
          {celebration.type==='all4'?(
            <div className="celeb-all4">
              <span className="bounce" style={{fontSize:48,display:"block",marginBottom:8}}>🏆</span>
              <div className="tf" style={{fontSize:32,color:"#FCC728",letterSpacing:1,marginBottom:4}}>PERFECT DAY!</div>
              <div className="df" style={{fontSize:14,color:"rgba(255,255,255,0.6)"}}>{celebration.label} hit all 4 goals!</div>
              <div style={{fontSize:28,marginTop:8}}>🎉🔥💪</div>
            </div>
          ):(
            <div className="celeb-single">
              <div style={{fontSize:32,marginBottom:6}}>{celebration.label.split(' ')[0]}</div>
              <div className="df" style={{fontSize:15,fontWeight:500,color:"#fff"}}>{celebration.label}</div>
            </div>
          )}
        </div>
      )}

      {/* HERO */}
      <div className="hero">
        <div style={{position:"relative",zIndex:1}}>
          <div className="tf" style={{fontSize:10,letterSpacing:6,color:"#FCC728",marginBottom:8,opacity:0.8}}>SUMMER 2026</div>
          <div className="tf" style={{fontSize:52,lineHeight:0.88,color:"#fff",marginBottom:2}}>90 DAY</div>
          <div className="tf" style={{fontSize:52,lineHeight:0.88,color:"#FCC728"}}>SUMMER STRONG</div>
          <div className="sf" style={{fontSize:15,fontStyle:"italic",color:"rgba(255,255,255,0.38)",marginTop:10}}>Challenge</div>
          <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {hasStarted&&currentDayNum?<span className="badge">Day {currentDayNum} of 90 🔥</span>:<span className="badge">Starts {fmtDate(START_DATE)}</span>}
            {participants.length>0&&<span className="badge" style={{background:"rgba(255,255,255,0.04)",borderColor:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"}}>{participants.length} players · ${pot} pot</span>}
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

      {/* WHO ARE YOU BAR */}
      {(activeTab==="board"||activeTab==="log")&&(
        <div className="who-bar">
          {activeParticipant?(
            <>
              <div style={{width:8,height:8,borderRadius:"50%",background:activeParticipant.color,flexShrink:0}}/>
              <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Viewing as</div>
              <div className="who-name">{activeParticipant.name}</div>
              <button className="who-change" onClick={()=>setShowUserPicker(true)}>Switch</button>
            </>
          ):(
            <>
              <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.4)",flex:1}}>Who are you?</div>
              <button className="who-change" style={{borderColor:"rgba(252,199,40,0.5)",color:"#FCC728"}} onClick={()=>setShowUserPicker(true)}>Select your name →</button>
            </>
          )}
        </div>
      )}

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
                  The <strong style={{color:"#FCC728"}}>90 Day Summer Strong Challenge</strong> runs from <strong style={{color:"#fff"}}>{fmtDate(START_DATE)}</strong> to <strong style={{color:"#fff"}}>{fmtDate("2026-06-27")}</strong>.{"\n\n"}Log your daily numbers — earn up to <strong style={{color:"#FCC728"}}>4 points</strong> per day automatically when you hit your goals.
                </div>
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:12}}>DAILY GOALS</div>
                {[
                  {icon:"💧",label:"Water",desc:"Log oz — hit your personal goal"},
                  {icon:"🥩",label:"Protein",desc:"Log grams — hit your personal goal"},
                  {icon:"🟢",label:"Green Ring",desc:"Log exercise minutes — hit 30 min"},
                  {icon:"🔴",label:"Red Ring",desc:"Log active calories — hit your goal (min 500)"},
                ].map(({icon,label,desc})=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <span style={{fontSize:22,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1}}><div className="tf" style={{fontSize:17}}>{label}</div><div className="note" style={{fontSize:12}}>{desc}</div></div>
                    <div className="tf" style={{fontSize:20,color:"#FCC728"}}>1 PT</div>
                  </div>
                ))}
              </div>
              <div className="info-divider"/>
              <div style={{marginBottom:20}}>
                <div className="tf" style={{fontSize:24,letterSpacing:1,marginBottom:4}}>PRIZES</div>
                <div className="note" style={{marginBottom:12}}>Based on {participants.length} players · ${pot} pot</div>
                <div className="prize-box prize-1">
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}><span style={{fontSize:26}}>🥇</span><div className="tf" style={{fontSize:24,color:"#FCC728"}}>1ST PLACE</div></div>
                  <div className="tf" style={{fontSize:42,color:"#FCC728",lineHeight:1}}>${first}</div>
                  <div className="note" style={{marginTop:4}}>70% of the pot</div>
                </div>
                <div className="prize-box prize-2">
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}><span style={{fontSize:22}}>🥈</span><div className="tf" style={{fontSize:20,color:"rgba(200,200,200,0.8)"}}>2ND PLACE</div></div>
                  <div className="tf" style={{fontSize:36,color:"rgba(200,200,200,0.7)",lineHeight:1}}>${second}</div>
                  <div className="note" style={{marginTop:4}}>30% of the pot</div>
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
                <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginBottom:14,lineHeight:1.6}}>Copy this prompt into Claude or ChatGPT to calculate your personal targets.</div>
                <div className="prompt-box">{AI_PROMPT}</div>
                <div style={{textAlign:"center",marginTop:12}}>
                  <button className={`copy-btn ${copied?"done":""}`} onClick={copyPrompt}>{copied?"✓ Copied!":"Copy Prompt"}</button>
                </div>
              </div>
              <div className="info-divider"/>
              {signupOpen() ? (
                <>
                  <button className="btn-gold" onClick={()=>{setActiveTab("manage");setAddingUser(true);}}>JOIN THE CHALLENGE 🔥</button>
                  <div className="note" style={{textAlign:"center",marginTop:10}}>After joining, send $20 to {VENMO} on Venmo.</div>
                </>
              ) : (
                <div style={{background:"rgba(125,48,49,0.12)",border:"1px solid rgba(125,48,49,0.3)",borderRadius:14,padding:"20px 16px",textAlign:"center"}}>
                  <div style={{fontSize:28,marginBottom:8}}>🔒</div>
                  <div className="tf" style={{fontSize:24,letterSpacing:1,color:"#c04a4c",marginBottom:6}}>REGISTRATION CLOSED</div>
                  <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>Sign-ups closed at midnight PT on March 31.<br/>The challenge is underway — check back next time!</div>
                </div>
              )}
            </div>
          )}

          {/* ── BOARD (LEADERBOARD) ── */}
          {activeTab==="board"&&(
            <div style={{paddingBottom:80}}>
              {participants.length===0?(
                <div style={{textAlign:"center",padding:"60px 24px"}}>
                  <div className="sf" style={{fontSize:24,color:"rgba(255,255,255,0.5)",marginBottom:8}}>No players yet!</div>
                  <button className="btn-gold" style={{width:"auto",padding:"14px 32px"}} onClick={()=>setActiveTab("info")}>SEE INFO →</button>
                </div>
              ):(
                <>
                  {/* Prize strip */}
                  <div style={{display:"flex",gap:8,padding:"12px 12px 4px"}}>
                    {[["🥇","1st Place",`$${first}`,"rgba(252,199,40,0.08)","rgba(252,199,40,0.18)","#FCC728"],
                      ["🥈","2nd Place",`$${second}`,"rgba(192,192,192,0.06)","rgba(192,192,192,0.14)","rgba(200,200,200,0.7)"],
                      ["💰","Total Pot",`$${pot}`,"rgba(255,255,255,0.03)","rgba(255,255,255,0.07)","rgba(255,255,255,0.55)"]
                    ].map(([icon,label,val,bg,border,color])=>(
                      <div key={label} style={{flex:1,background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                        <div className="note" style={{marginBottom:3}}>{icon} {label}</div>
                        <div className="tf" style={{fontSize:22,color}}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Day progress */}
                  {hasStarted&&currentDayNum&&(
                    <div style={{margin:"8px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
                      <div>
                        <div className="tf" style={{fontSize:28,color:"#FCC728",lineHeight:1}}>DAY {currentDayNum}</div>
                        <div className="note">{90-currentDayNum} days remaining</div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${(currentDayNum/90)*100}%`,background:"linear-gradient(90deg,#7D3031,#FCC728)",borderRadius:99,transition:"width 1s ease"}}/>
                        </div>
                        <div className="note" style={{marginTop:4,textAlign:"right"}}>{Math.round((currentDayNum/90)*100)}% through</div>
                      </div>
                    </div>
                  )}

                  {/* Leaderboard rows */}
                  <div style={{marginTop:8}}>
                    {sorted.map((p,i)=>{
                      const pts = calcPoints(p.id);
                      const pct = Math.round((pts/MAX_PER_PERSON)*100);
                      const streak = calcStreak(p.id);
                      const todayInp = getInput(today, p.id);
                      const todayHit = goalsHit(todayInp, p.goals);
                      const todayCount = countHit(todayInp, p.goals);
                      const isMe = p.id === activeUser;
                      const rankColor = i===0?"#FCC728":i===1?"rgba(200,200,200,0.6)":i===2?"rgba(205,127,50,0.7)":"rgba(255,255,255,0.15)";
                      return(
                        <div key={p.id} className={`lb-row ${isMe?"me":""}`}>
                          <div className="lb-rank" style={{color:rankColor}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                              <div className="lb-name">{p.name}{isMe&&<span className="df" style={{fontSize:9,color:"rgba(252,199,40,0.5)",marginLeft:6,letterSpacing:1,fontWeight:600}}>YOU</span>}</div>
                            </div>
                            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>
                              <div className="lb-sub">{streak>0?`🔥 ${streak} day streak`:"No streak yet"}</div>
                              <div className="lb-sub">·</div>
                              <div className="lb-sub">{pct}% complete</div>
                            </div>
                            {hasStarted&&(
                              <div className="today-pills">
                                {[
                                  {icon:"💧",h:todayHit.water,val:todayInp?.water_oz,u:"oz"},
                                  {icon:"🥩",h:todayHit.protein,val:todayInp?.protein_g,u:"g"},
                                  {icon:"🟢",h:todayHit.green,val:todayInp?.exercise_min,u:"m"},
                                  {icon:"🔴",h:todayHit.red,val:todayInp?.calories,u:"cal"},
                                ].map(({icon,h,val,u},idx)=>(
                                  <div key={idx} className={`today-pill ${h?"hit":"miss"}`}>
                                    {icon} {val&&val>0?`${val}${u}`:"—"}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:99,marginTop:6,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${p.color}66,${p.color})`,borderRadius:99,transition:"width 0.7s"}}/>
                            </div>
                          </div>
                          <div>
                            <div className="lb-pts" style={{color:p.color}}>{pts}</div>
                            <div className="note" style={{textAlign:"right",fontSize:10}}>pts</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── LOG TAB ── */}
          {activeTab==="log"&&(
            <div style={{paddingBottom:80}}>
              {!activeUser?(
                <div style={{textAlign:"center",padding:"60px 24px"}}>
                  <div className="sf" style={{fontSize:20,color:"rgba(255,255,255,0.5)",marginBottom:16}}>Select your name first</div>
                  <button className="btn-gold" style={{width:"auto",padding:"14px 32px"}} onClick={()=>setShowUserPicker(true)}>Who are you? →</button>
                </div>
              ):!activeParticipant?(
                <div style={{textAlign:"center",padding:"60px 24px",color:"rgba(255,255,255,0.3)"}} className="df">Player not found.</div>
              ):(
                <>
                  {/* My stats summary */}
                  <div style={{margin:"12px 12px 4px",background:"rgba(255,255,255,0.03)",border:`1px solid ${activeParticipant.color}44`,borderRadius:12,padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div className="tf" style={{fontSize:24,color:activeParticipant.color}}>{activeParticipant.name}</div>
                        <div className="note">{activeParticipant.goals.protein}g protein · {activeParticipant.goals.water}oz water · 30min · {activeParticipant.goals.red}cal</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div className="tf" style={{fontSize:36,color:activeParticipant.color,lineHeight:1}}>{calcPoints(activeUser)}</div>
                        <div className="note">/ {MAX_PER_PERSON} pts</div>
                      </div>
                    </div>
                    <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:99,marginTop:10,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${Math.round((calcPoints(activeUser)/MAX_PER_PERSON)*100)}%`,background:`linear-gradient(90deg,${activeParticipant.color}66,${activeParticipant.color})`,borderRadius:99}}/>
                    </div>
                  </div>

                  {/* Day cards — only past + today, newest first */}
                  <div style={{marginTop:8}}>
                    {days.filter(d=>d<=today).reverse().map((date,i)=>{
                      const dayNum = getDayNumber(date);
                      const isToday = date===today;
                      const inp = getInput(date, activeUser);
                      const hit = goalsHit(inp, activeParticipant.goals);
                      const total = countHit(inp, activeParticipant.goals);
                      return(
                        <div key={date} className={`day-card ${isToday?"today-card":""}`}>
                          <div className="day-card-header" onClick={()=>openDayLog(date)}>
                            <div className={`day-num-big ${isToday?"td":""}`}>{dayNum}</div>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <div className="df" style={{fontSize:13,fontWeight:500,color:isToday?"#FCC728":"rgba(255,255,255,0.7)"}}>{isToday?"Today":fmtShort(date)}</div>
                                {total===4&&<span style={{fontSize:12}}>🏆</span>}
                              </div>
                              <div style={{display:"flex",gap:4,marginTop:4}}>
                                {[hit.water,hit.protein,hit.green,hit.red].map((h,idx)=>(
                                  <div key={idx} style={{width:16,height:3,borderRadius:99,background:h?"#4caf50":"rgba(255,255,255,0.1)"}}/>
                                ))}
                                <div className="note" style={{marginLeft:4,fontSize:10}}>{total}/4 pts</div>
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                              <div className="tf" style={{fontSize:20,color:total>0?activeParticipant.color:"rgba(255,255,255,0.2)"}}>{total}pt</div>
                              <div className="df" style={{fontSize:10,color:"rgba(252,199,40,0.6)"}}>
                                {inp?"✏️ edit":"➕ log"}
                              </div>
                            </div>
                          </div>
                          {inp&&(
                            <div style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                              {[
                                {icon:"💧",val:inp.water_oz,unit:"oz",goal:activeParticipant.goals.water,h:hit.water},
                                {icon:"🥩",val:inp.protein_g,unit:"g",goal:activeParticipant.goals.protein,h:hit.protein},
                                {icon:"🟢",val:inp.exercise_min,unit:"min",goal:30,h:hit.green},
                                {icon:"🔴",val:inp.calories,unit:"cal",goal:activeParticipant.goals.red,h:hit.red},
                              ].map(({icon,val,unit,goal,h},idx)=>(
                                <div key={idx} className="log-stat">
                                  <span style={{fontSize:16,width:22,textAlign:"center",flexShrink:0}}>{icon}</span>
                                  <span className="df" style={{flex:1,fontSize:13,color:h?"#4caf50":"rgba(255,255,255,0.5)",fontWeight:500}}>{val>0?val:"—"} {unit}</span>
                                  <span className="note">/ {goal}{unit}</span>
                                  <span style={{fontSize:12,width:20,textAlign:"center"}}>{h?"✅":""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── RULES ── */}
          {activeTab==="rules"&&(
            <div style={{padding:"22px 18px 80px"}}>
              <div className="tf" style={{fontSize:30,letterSpacing:1,marginBottom:18}}>CHALLENGE RULES</div>
              {[
                {icon:"💧",title:"Water",body:"Log your daily oz. Hit your personal goal = 1 point."},
                {icon:"🥩",title:"Protein",body:"Log your daily grams. Hit your personal goal = 1 point."},
                {icon:"🟢",title:"Green Ring",body:"Log your exercise minutes. Hit 30 min = 1 point."},
                {icon:"🔴",title:"Red Ring",body:"Log your active calories.\nHit your personal goal (min 500 cal) = 1 point."},
                {icon:"🏆",title:"Scoring",body:"Points awarded automatically when you hit your goal.\nMax 4 pts/day · 360 pts over 90 days."},
                {icon:"💰",title:"Buy In",body:`$20 via Venmo to ${VENMO}\nSend before the start date.`},
                {icon:"🥇",title:"Prizes",body:"1st place: 70% of the pot\n2nd place: 30% of the pot"},
                {icon:"📅",title:"Duration",body:`${fmtDate(START_DATE)} → ${fmtDate("2026-06-27")}`},
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
              {participants.length===0&&<div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.3)",marginBottom:18}}>No one has joined yet.</div>}
              {participants.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"13px 14px",marginBottom:9}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="tf" style={{fontSize:20}}>{p.name}</div>
                    <div className="note">{p.goals.protein}g · {p.goals.water}oz · 30min · {p.goals.red}cal · <span style={{color:p.color}}>{calcPoints(p.id)} pts</span></div>
                  </div>
                  <button onClick={()=>removeParticipant(p.id)} disabled={saving} style={{background:"none",border:"1px solid rgba(255,255,255,0.09)",color:"rgba(255,255,255,0.28)",borderRadius:8,padding:"5px 11px",cursor:"pointer",fontFamily:"DM Sans",fontSize:11,flexShrink:0}}>Remove</button>
                </div>
              ))}
              {signupOpen() ? (
                <>
                  <button className="btn-gold" style={{marginTop:10}} onClick={()=>setAddingUser(true)} disabled={saving}>+ JOIN THE CHALLENGE</button>
                  <div className="note" style={{textAlign:"center",marginTop:10}}>After joining, send $20 to {VENMO} on Venmo.</div>
                </>
              ) : (
                <div style={{background:"rgba(125,48,49,0.1)",border:"1px solid rgba(125,48,49,0.25)",borderRadius:12,padding:"16px",textAlign:"center",marginTop:10}}>
                  <div className="tf" style={{fontSize:20,color:"#c04a4c",letterSpacing:1,marginBottom:4}}>🔒 REGISTRATION CLOSED</div>
                  <div className="note">Sign-ups closed at midnight PT on March 31.</div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* WHO ARE YOU PICKER */}
      {showUserPicker&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)setShowUserPicker(false);}}>
          <div className="modal">
            <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:4}}>WHO ARE YOU?</div>
            <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginBottom:20}}>Your choice is saved on this device</div>
            <div className="user-grid">
              {participants.map(p=>(
                <div key={p.id} className={`user-option ${activeUser===p.id?"selected":""}`} onClick={()=>setUser(p.id)}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div className="tf" style={{fontSize:22}}>{p.name}</div>
                    <div className="note">{p.goals.protein}g · {p.goals.water}oz · {p.goals.red}cal</div>
                  </div>
                  {activeUser===p.id&&<span style={{color:"#FCC728",fontSize:18}}>✓</span>}
                </div>
              ))}
            </div>
            <button className="btn-ghost" style={{marginTop:16}} onClick={()=>setShowUserPicker(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ADD PLAYER MODAL */}
      {addingUser&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget){setAddingUser(false);setStep(1);setNewName("");}}}>
          <div className="modal">
            {step===1&&(
              <>
                <div className="tf" style={{fontSize:28,letterSpacing:1,marginBottom:4}}>JOIN THE CHALLENGE</div>
                <div className="df" style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginBottom:22}}>Step 1 of 2 — What's your name?</div>
                <input className="inp" placeholder="Your name" value={newName} autoFocus onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newName.trim())setStep(2);}}/>
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
                <div className="note" style={{marginBottom:16,lineHeight:1.6}}>🟢 Green ring goal is fixed: 30 min exercise.</div>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn-ghost" onClick={()=>setStep(1)}>← Back</button>
                  <button className="btn-gold" onClick={addParticipant} disabled={saving}>{saving?"Saving…":"JOIN 🔥"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* DAY LOG MODAL */}
      {activeDayLog&&draftPerson&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)setActiveDayLog(null);}}>
          <div className="modal" style={{maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
              <div className="tf" style={{fontSize:26,letterSpacing:1}}>{activeDayLog===today?"LOG TODAY":"LOG DAY"}</div>
              <div>
                <div className="tf" style={{fontSize:16,color:draftPerson.color,textAlign:"right"}}>{draftPerson.name}</div>
                <div className="note" style={{textAlign:"right"}}>{activeDayLog===today?`Day ${currentDayNum}`:fmtShort(activeDayLog)}</div>
              </div>
            </div>

            {/* Live preview bar */}
            <div style={{display:"flex",gap:8,marginBottom:20,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"12px 16px",border:"1px solid rgba(255,255,255,0.07)"}}>
              <div className="tf" style={{fontSize:36,color:draftPerson.color,lineHeight:1}}>{draftCount}</div>
              <div style={{flex:1}}>
                <div className="df" style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>points this day</div>
                <div style={{display:"flex",gap:4,marginTop:4}}>
                  {[draftHit.water,draftHit.protein,draftHit.green,draftHit.red].map((h,i)=>(
                    <div key={i} style={{width:20,height:4,borderRadius:2,background:h?"#4caf50":"rgba(255,255,255,0.1)",transition:"background 0.2s"}}/>
                  ))}
                </div>
              </div>
              {draftCount===4&&<div style={{fontSize:24}}>🏆</div>}
            </div>

            {[
              {key:"water_oz",icon:"💧",label:"Water",unit:"oz",goal:draftPerson.goals.water,hit:draftHit.water},
              {key:"protein_g",icon:"🥩",label:"Protein",unit:"grams",goal:draftPerson.goals.protein,hit:draftHit.protein},
              {key:"exercise_min",icon:"🟢",label:"Exercise",unit:"minutes",goal:30,hit:draftHit.green},
              {key:"calories",icon:"🔴",label:"Active Calories",unit:"cal",goal:draftPerson.goals.red,hit:draftHit.red},
            ].map(({key,icon,label,unit,goal,hit})=>(
              <div key={key} style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div className="df" style={{fontSize:13,color:"rgba(255,255,255,0.6)",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:18}}>{icon}</span>{label}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div className="note">Goal: {goal} {unit}</div>
                    {hit&&<span style={{fontSize:14}}>✅</span>}
                  </div>
                </div>
                <input className={`num-inp ${hit?"hit":""}`} type="number" placeholder={`Enter ${unit}…`}
                  value={draftInputs[key]} onChange={e=>setDraftInputs(d=>({...d,[key]:e.target.value}))}/>
                {hit&&<div className="df" style={{fontSize:11,color:"#4caf50",marginTop:4}}>✓ Goal hit! +1 point</div>}
              </div>
            ))}
            <div style={{display:"flex",gap:10,marginTop:8}}>
              <button className="btn-ghost" onClick={()=>setActiveDayLog(null)}>Cancel</button>
              <button className="btn-gold" onClick={saveDayLog} disabled={saving}>{saving?"Saving…":"SAVE 💾"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
