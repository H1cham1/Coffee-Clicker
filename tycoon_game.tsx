import React, { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    tempSaveData: string | null;
  }
}

interface Multipliers {
  production: number;
  eventBoost: number;
}

interface CostReduction {
  active: boolean;
  pct: number;
}

interface Building {
  id: string;
  name: string;
  icon: string;
  baseCost: number;
  baseRate: number;
  count: number;
  progress: number;
  getCost(costReduction: CostReduction): number;
  buyMax(cash: number, costReduction: CostReduction): { bought: number; newCash: number };
  buy(n: number, cash: number, costReduction: CostReduction): { bought: number; newCash: number };
  getRate(multipliers: Multipliers, brandPoints: number): number;
  getRatePerUnit(multipliers: Multipliers, brandPoints: number): number;
  tick(dt: number, multipliers: Multipliers, brandPoints: number): number;
}

interface Upgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  multiplierIncrease: number;
  enablesCostReduction: number;
  bought: boolean;
  canBuy(cash: number): boolean;
  buy(cash: number): { success: boolean; newCash: number };
}

interface GameState {
  cash: number;
  totalEarned: number;
  brandPoints: number;
  multipliers: Multipliers;
  speed: number;
  buyMax: boolean;
  buildings: Building[];
  upgrades: Upgrade[];
  costReduction: CostReduction;
}

interface ActiveEvent {
  id: string;
  name: string;
  dur: number;
  boost: number;
  text: string;
  remaining: number;
}

interface Toast {
  show: boolean;
  message: string;
  kind: string;
}

const CoffeeCorpTycoon: React.FC = () => {
  // ======= Utility Functions =======
  const fmt = (n: number) => {
    if (!isFinite(n)) return "$∞";
    const neg = n < 0; 
    n = Math.abs(n);
    const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0; 
    while (n >= 1000 && i < units.length - 1) { 
      n /= 1000; 
      i++; 
    }
    return (neg?'-':'') + '$' + (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + units[i];
  };

  const pct = (n: number) => (n*100).toFixed(0) + '%';
  const clamp = (v: number, min: number, max: number) => Math.max(min,Math.min(max,v));

  // ======= Game State =======

  const [gameState, setGameState] = useState<GameState>({
    cash: 0,
    totalEarned: 0,
    brandPoints: 0,
    multipliers: {
      production: 0,
      eventBoost: 0,
    },
    speed: 1,
    buyMax: false,
    buildings: [],
    upgrades: [],
    costReduction: { active: false, pct: 0 }
  });

  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [eventTimer, setEventTimer] = useState<number>(5 + Math.random() * 15);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', kind: 'info' });

  // ======= Building and Upgrade Classes =======
  interface BuildingConstructor {
    id: string;
    name: string;
    icon: string;
    baseCost: number;
    baseRate: number;
    count?: number;
    progress?: number;
  }

  class Building {
    id: string;
    name: string;
    icon: string;
    baseCost: number;
    baseRate: number;
    count: number;
    progress: number;

    constructor({id, name, icon, baseCost, baseRate, count = 0, progress = 0}: BuildingConstructor) {
      this.id = id;
      this.name = name;
      this.icon = icon;
      this.baseCost = baseCost;
      this.baseRate = baseRate;
      this.count = count;
      this.progress = progress;
    }

    getCost(costReduction: CostReduction): number {
      const raw = Math.ceil(this.baseCost * Math.pow(1.15, this.count));
      if (costReduction.active) {
        return Math.max(1, Math.floor(raw * (1 - costReduction.pct)));
      }
      return raw;
    }

    getRatePerUnit(multipliers: Multipliers, brandPoints: number): number {
      return this.baseRate * (1 + multipliers.production + multipliers.eventBoost) * (1 + brandPoints * 0.1);
    }

    getRate(multipliers: Multipliers, brandPoints: number): number {
      return this.count * this.getRatePerUnit(multipliers, brandPoints);
    }

    tick(dt: number, multipliers: Multipliers, brandPoints: number): number {
      const perSec = this.getRate(multipliers, brandPoints);
      const perTick = perSec * dt;
      this.progress = (this.progress + clamp(perTick/Math.max(1, this.count*5), 0, .4)) % 1;
      return perTick;
    }

    buy(n: number, cash: number, costReduction: CostReduction): { bought: number; newCash: number } {
      let bought = 0;
      let remainingCash = cash;
      while (bought < n && remainingCash >= this.getCost(costReduction)) {
        remainingCash -= this.getCost(costReduction);
        this.count++;
        bought++;
      }
      return { bought, newCash: remainingCash };
    }

    buyMax(cash: number, costReduction: CostReduction): { bought: number; newCash: number } {
      let bought = 0;
      let remainingCash = cash;
      while (remainingCash >= this.getCost(costReduction)) {
        remainingCash -= this.getCost(costReduction);
        this.count++;
        bought++;
      }
      return { bought, newCash: remainingCash };
    }
  }

  interface UpgradeConstructor {
    id: string;
    name: string;
    desc: string;
    cost: number;
    multiplierIncrease?: number;
    enablesCostReduction?: number;
    bought?: boolean;
  }

  class Upgrade {
    id: string;
    name: string;
    desc: string;
    cost: number;
    multiplierIncrease: number;
    enablesCostReduction: number;
    bought: boolean;

    constructor({id, name, desc, cost, multiplierIncrease, enablesCostReduction, bought = false}: UpgradeConstructor) {
      this.id = id;
      this.name = name;
      this.desc = desc;
      this.cost = cost;
      this.multiplierIncrease = multiplierIncrease || 0;
      this.enablesCostReduction = enablesCostReduction || 0;
      this.bought = bought;
    }

    canBuy(cash: number): boolean {
      return !this.bought && cash >= this.cost;
    }

    buy(cash: number): { success: boolean; newCash: number } {
      if (this.canBuy(cash)) {
        return { success: true, newCash: cash - this.cost };
      }
      return { success: false, newCash: cash };
    }
  }

  // ======= Data =======
  const BUILDING_DATA = [
    {id:'kiosk',   name:'Coffee Cart',       icon:'🛒', baseCost: 15,    baseRate: 0.5},
    {id:'cart',    name:'Street Barista',    icon:'☕', baseCost: 120,   baseRate: 3},
    {id:'stand',   name:'Coffee Stand',      icon:'🧃', baseCost: 850,   baseRate: 12},
    {id:'cafe',    name:'Café',              icon:'🏠', baseCost: 4200,  baseRate: 42},
    {id:'truck',   name:'Food Truck',        icon:'🚚', baseCost: 24000, baseRate: 210},
    {id:'roast',   name:'Roastery',          icon:'🔥', baseCost: 125000,baseRate: 1100},
    {id:'chain',   name:'Chain Store',       icon:'🏢', baseCost: 700000,baseRate: 6400},
  ];

  const UPGRADE_DATA = [
    {id:'beans',   name:'Specialty Beans', desc:'+25% total production', cost: 2000, multiplierIncrease: 0.25},
    {id:'milk',    name:'Milk Foam Masters', desc:'+25% total production', cost: 8500, multiplierIncrease: 0.25},
    {id:'barista', name:'Barista Training', desc:'+50% total production', cost: 35000, multiplierIncrease: 0.50},
    {id:'app',     name:'Order App', desc:'+75% total production', cost: 160000, multiplierIncrease: 0.75},
    {id:'solar',   name:'Solar Panels', desc:'Costs -5% (all purchases)', cost: 90000, enablesCostReduction: 0.05},
  ];

  // ======= Initialize Buildings and Upgrades =======
  useEffect(() => {
    if (gameState.buildings.length === 0) {
      const buildings = BUILDING_DATA.map(data => new Building(data));
      const upgrades = UPGRADE_DATA.map(data => new Upgrade(data));
      
      setGameState((prev: GameState) => ({
        ...prev,
        buildings,
        upgrades
      }));
    }
  }, []);

  // ======= Events System =======
  const startRandomEvent = useCallback(() => {
    const roll = Math.random();
    let event;
    
    if (roll < 0.5) {
      event = {id:'rush', name:'Rush Hour', dur:12, boost:0.5, text:'Customer storm! Production +50%'};
    } else if (roll < 0.8) {
      event = {id:'promo', name:'Press Feature', dur:18, boost:0.35, text:'Great press! +35% production'};
    } else {
      event = {id:'inspect', name:'Inspection', dur:8, boost:-0.25, text:'Health inspection... -25% temporarily'};
    }

    setActiveEvent({...event, remaining: event.dur});
    setGameState((prev: GameState) => ({
      ...prev,
      multipliers: {
        ...prev.multipliers,
        eventBoost: prev.multipliers.eventBoost + event.boost
      }
    }));

    showToast(`📰 <b>${event.name}</b> — ${event.text}`, event.boost < 0 ? 'warn' : 'info');
  }, []);

  const endEvent = useCallback(() => {
    if (!activeEvent) return;
    
    setGameState((prev: GameState) => ({
      ...prev,
      multipliers: {
        ...prev.multipliers,
        eventBoost: prev.multipliers.eventBoost - activeEvent.boost
      }
    }));
    
    setActiveEvent(null);
    setEventTimer(5 + Math.random() * 15);
  }, [activeEvent]);

  // ======= Toast System =======
  const showToast = (message: string, kind: string = 'info'): void => {
    setToast({ show: true, message, kind });
    setTimeout(() => setToast((prev: Toast) => ({ ...prev, show: false })), 3500);
  };

  // ======= Prestige System =======
  const prestigePointsFor = (totalEarned: number): number => {
    return Math.floor(Math.pow(totalEarned/500000, 0.7));
  };

  const doPrestige = (): void => {
    const pts = prestigePointsFor(gameState.totalEarned);
    if (pts <= 0) return;

    const newBuildings = gameState.buildings.map((b: Building) => new Building({
      id: b.id, name: b.name, icon: b.icon, baseCost: b.baseCost, baseRate: b.baseRate, count: 0
    }));
    
    const newUpgrades = gameState.upgrades.map((u: Upgrade) => new Upgrade({
      id: u.id, name: u.name, desc: u.desc, cost: u.cost, 
      multiplierIncrease: u.multiplierIncrease, enablesCostReduction: u.enablesCostReduction, bought: false
    }));

    setGameState((prev: GameState) => ({
      ...prev,
      cash: 0,
      totalEarned: 0,
      brandPoints: prev.brandPoints + pts,
      multipliers: { production: 0, eventBoost: 0 },
      buildings: newBuildings,
      upgrades: newUpgrades,
      costReduction: { active: false, pct: 0 }
    }));

    setActiveEvent(null);
    showToast(`✨ Prestige! You earned <b>${pts}</b> brand point(s).`);
  };

  // ======= Save/Load Functions =======
  const save = (): void => {
    const data = {
      cash: gameState.cash,
      totalEarned: gameState.totalEarned,
      brandPoints: gameState.brandPoints,
      multipliers: { production: gameState.multipliers.production },
      buildings: gameState.buildings.map((b: Building) => ({id: b.id, count: b.count})),
      upgrades: gameState.upgrades.map((u: Upgrade) => ({id: u.id, bought: u.bought})),
      costReduction: gameState.costReduction
    };
    
    // Using a state variable instead of localStorage
    window.tempSaveData = JSON.stringify(data);
    showToast('💾 Saved');
  };

  const load = (): void => {
    const raw = window.tempSaveData;
    if (!raw) return;
    
    try {
      const data = JSON.parse(raw);
      
      const loadedBuildings = gameState.buildings.map((b: Building) => {
        const saved = data.buildings?.find((x: any) => x.id === b.id);
        return new Building({
          id: b.id, name: b.name, icon: b.icon, baseCost: b.baseCost, baseRate: b.baseRate,
          count: saved ? saved.count || 0 : 0
        });
      });

      const loadedUpgrades = gameState.upgrades.map((u: Upgrade) => {
        const saved = data.upgrades?.find((x: any) => x.id === u.id);
        return new Upgrade({
          id: u.id, name: u.name, desc: u.desc, cost: u.cost,
          multiplierIncrease: u.multiplierIncrease, enablesCostReduction: u.enablesCostReduction,
          bought: saved ? !!saved.bought : false
        });
      });

      setGameState((prev: GameState) => ({
        ...prev,
        cash: data.cash || 0,
        totalEarned: data.totalEarned || 0,
        brandPoints: data.brandPoints || 0,
        multipliers: {
          ...prev.multipliers,
          production: data.multipliers?.production || 0
        },
        buildings: loadedBuildings,
        upgrades: loadedUpgrades,
        costReduction: data.costReduction || { active: false, pct: 0 }
      }));

      showToast('✅ Save loaded');
    } catch (e) {
      console.error(e);
      showToast('Could not load save', 'bad');
    }
  };

  const exportSave = (): void => {
    const data = window.tempSaveData || '{}';
    navigator.clipboard.writeText(data).then(() => showToast('📋 Exported to clipboard'));
  };

  const importSave = (): void => {
    const s = prompt('Paste your save JSON:');
    if (!s) return;
    try {
      window.tempSaveData = s;
      load();
    } catch {
      showToast('Invalid JSON', 'bad');
    }
  };

  const hardReset = (): void => {
    if (confirm('Are you sure? This will reset EVERYTHING.')) {
      window.tempSaveData = null;
      window.location.reload();
    }
  };

  // ======= Game Actions =======
  const handleClick = (): void => {
    const gain = 1 * (1 + gameState.multipliers.production + gameState.multipliers.eventBoost + gameState.brandPoints * 0.1);
    setGameState((prev: GameState) => ({
      ...prev,
      cash: prev.cash + gain,
      totalEarned: prev.totalEarned + gain
    }));
  };

  const toggleBuyMax = (): void => {
    setGameState((prev: GameState) => ({ ...prev, buyMax: !prev.buyMax }));
  };

  const toggleSpeed = (): void => {
    setGameState((prev: GameState) => ({ ...prev, speed: prev.speed === 1 ? 2 : 1 }));
  };

  const buyBuilding = (buildingId: string, amount: number | 'max' = 1): void => {
    setGameState((prev: GameState) => {
      const building = prev.buildings.find(b => b.id === buildingId);
      if (!building) return prev;

      let result;
      if (amount === 'max') {
        result = building.buyMax(prev.cash, prev.costReduction);
      } else {
        result = building.buy(amount, prev.cash, prev.costReduction);
      }

      if (result.bought > 0) {
        return {
          ...prev,
          cash: result.newCash,
          buildings: prev.buildings.map((b: Building) => 
            b.id === buildingId ? building : b
          )
        };
      }
      return prev;
    });
  };

  const buyUpgrade = (upgradeId: string): void => {
    setGameState((prev: GameState) => {
      const upgrade = prev.upgrades.find(u => u.id === upgradeId);
      if (!upgrade) return prev;

      const result = upgrade.buy(prev.cash);
      if (result.success) {
        upgrade.bought = true;
        const newState = {
          ...prev,
          cash: result.newCash,
          upgrades: [...prev.upgrades]
        };

        if (upgrade.multiplierIncrease > 0) {
          newState.multipliers = {
            ...prev.multipliers,
            production: prev.multipliers.production + upgrade.multiplierIncrease
          };
        }

        if (upgrade.enablesCostReduction > 0) {
          newState.costReduction = {
            active: true,
            pct: upgrade.enablesCostReduction
          };
        }

        showToast(`✅ Upgrade purchased: <b>${upgrade.name}</b>`, 'info');
        return newState;
      }
      return prev;
    });
  };

  // ======= Game Loop =======
  const lastTime = useRef<number>(performance.now());

  useEffect(() => {
    const loop = () => {
      const now = performance.now();
      const dt = (now - lastTime.current) / 1000 * gameState.speed;
      lastTime.current = now;

      setGameState((prev: GameState) => {
        let totalEarnings = 0;
        prev.buildings.forEach((b: Building) => {
          const earnings = b.tick(dt, prev.multipliers, prev.brandPoints);
          totalEarnings += earnings;
        });

        return {
          ...prev,
          cash: prev.cash + totalEarnings,
          totalEarned: prev.totalEarned + totalEarnings
        };
      });

      // Event system
      if (activeEvent) {
        const newRemaining = activeEvent.remaining - dt;
        if (newRemaining <= 0) {
          endEvent();
        } else {
          setActiveEvent((prev: ActiveEvent | null) => prev ? ({ ...prev, remaining: newRemaining }) : null);
        }
      } else {
        const newTimer = eventTimer - dt;
        if (newTimer <= 0) {
          startRandomEvent();
        } else {
          setEventTimer(newTimer);
        }
      }

      requestAnimationFrame(loop);
    };

    const animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, [gameState.speed, activeEvent, eventTimer, endEvent, startRandomEvent]);

  // ======= Auto-save =======
  useEffect(() => {
    const interval = setInterval(save, 10000);
    return () => clearInterval(interval);
  }, [gameState]);

  // ======= Load on mount =======
  useEffect(() => {
    load();
  }, []);

  // ======= Computed Values =======
  const totalRate = gameState.buildings.reduce((a: number, b: Building) => a + b.getRate(gameState.multipliers, gameState.brandPoints), 0);
  const prestigePoints = prestigePointsFor(gameState.totalEarned);
  const productionMultiplier = 1 + gameState.multipliers.production + gameState.multipliers.eventBoost + gameState.brandPoints * 0.1;

  return (
    <>
      <style>{`
        :root{
          --bg:#0f172a;         /* slate-900 */
          --panel:#111827;      /* gray-900 */
          --card:#1f2937;       /* gray-800 */
          --muted:#94a3b8;      /* slate-400 */
          --text:#e5e7eb;       /* gray-200 */
          --accent:#22c55e;     /* green-500 */
          --accent-2:#38bdf8;   /* sky-400 */
          --danger:#ef4444;     /* red-500 */
          --warn:#f59e0b;       /* amber-500 */
        }
        *{box-sizing:border-box}
        html,body{height:100%}
        body{
          margin:0; background:linear-gradient(180deg, #0b1024, #0f172a); color:var(--text);
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji";
        }
        .header{
          position:sticky; top:0; z-index:30; backdrop-filter:saturate(140%) blur(8px);
          background:rgba(15,23,42,.85); border-bottom:1px solid rgba(148,163,184,.15);
        }
        .wrap{max-width:1100px; margin:0 auto; padding:14px 16px}
        .row{display:flex; gap:12px; align-items:center; flex-wrap:wrap}
        .brand{font-weight:800; letter-spacing:.3px}
        .pill{padding:6px 10px; border:1px solid rgba(148,163,184,.2); border-radius:999px; display:inline-flex; gap:8px; align-items:center}
        .pill small{color:var(--muted)}
        .kpi{display:flex; gap:10px; align-items:baseline}
        .kpi b{font-size:18px}
        .kpi small{color:var(--muted)}

        .main{max-width:1100px; margin:18px auto; padding:0 16px; display:grid; grid-template-columns: 320px 1fr; gap:16px}
        @media (max-width: 900px){ .main{grid-template-columns: 1fr} }

        .panel{background:var(--panel); border:1px solid rgba(148,163,184,.15); border-radius:16px; padding:14px}
        .card{background:var(--card); border:1px solid rgba(148,163,184,.12); border-radius:16px; padding:14px}
        .title{font-weight:700; font-size:14px; letter-spacing:.25px; color:#cbd5e1; margin-bottom:10px}
        .subtitle{color:var(--muted); font-size:12px}

        .grid{display:grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap:12px}

        button{cursor:pointer; border:0; padding:10px 12px; border-radius:12px; font-weight:700}
        .btn{background:var(--accent); color:#052e16}
        .btn:disabled{opacity:.5; cursor:not-allowed}
        .btn-secondary{background:#0b1227; color:#d1d5db; border:1px solid rgba(148,163,184,.25)}
        .btn-ghost{background:transparent; color:#cbd5e1; border:1px dashed rgba(148,163,184,.35)}

        .building{display:flex; gap:12px}
        .building .icon{font-size:22px}
        .building h3{margin:0; font-size:15px}
        .muted{color:var(--muted)}

        .progress{height:8px; background:rgba(148,163,184,.2); border-radius:999px; overflow:hidden}
        .bar{height:100%; background:var(--accent-2); width:0%}

        .row-split{display:flex; justify-content:space-between; align-items:center}

        .toast{
          position: fixed; right:16px; bottom:16px; min-width:260px; max-width:340px; padding:12px 14px;
          border-radius:14px; background:rgba(15,23,42,.95); border:1px solid rgba(148,163,184,.25);
          box-shadow:0 10px 24px rgba(0,0,0,.35); display:none
        }
        .toast.show{display:block; animation:pop .2s ease-out}
        @keyframes pop{ from{ transform:translateY(8px); opacity:0 } to{ transform:translateY(0); opacity:1 } }

        .badge{display:inline-flex; gap:6px; align-items:center; font-size:12px; padding:4px 8px; border-radius:999px; border:1px solid rgba(148,163,184,.25); color:#cbd5e1}
        .badge.warn{border-color:rgba(245,158,11,.45); color:#fde68a}
        .badge.good{border-color:rgba(34,197,94,.45); color:#bbf7d0}

        .footer{color:var(--muted); font-size:12px; text-align:center; padding:18px}
        .link{color:#93c5fd; text-decoration:underline dotted}
        .danger{color:#fecaca}
        .hr{height:1px; background:rgba(148,163,184,.18); margin:10px 0}
      `}</style>

      <header className="header">
        <div className="wrap row">
          <div className="brand">☕ Coffee Corp Tycoon</div>
          <div className="pill"><small>Cash</small><b>{fmt(gameState.cash)}</b></div>
          <div className="pill"><small>$/s</small><b>{fmt(totalRate)}</b></div>
          <div className="pill"><small>Total Earned</small><b>{fmt(gameState.totalEarned)}</b></div>
          <div className="pill"><small>Brand Points</small><b>{gameState.brandPoints}</b></div>
          
          {activeEvent && (
            <span className={`badge ${activeEvent.boost > 0 ? 'good' : 'warn'}`}>
              {activeEvent.name} {activeEvent.boost > 0 ? '+' : ''}{Math.round(activeEvent.boost * 100)}% · {Math.ceil(activeEvent.remaining)}s
            </span>
          )}
          
          <div style={{marginLeft:'auto'}} className="row">
            <button className="btn-secondary" onClick={save}>Save</button>
            <button className="btn-secondary" onClick={exportSave}>Export</button>
            <button className="btn-secondary" onClick={importSave}>Import</button>
            <button className="btn-ghost danger" onClick={hardReset}>Reset</button>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <div className="title">Your Business</div>
          <div className="subtitle">Production multiplier: x{productionMultiplier.toFixed(2)}</div>
          <div className="hr"></div>
          <div className="row" style={{gap:'8px'}}>
            <button className="btn" onClick={handleClick}>Brew Coffee (+$1)</button>
            <button className="btn-secondary" onClick={toggleBuyMax}>
              {gameState.buyMax ? 'Buy 1' : 'Buy Max'}
            </button>
            <button className="btn-secondary" onClick={toggleSpeed}>
              {gameState.speed === 2 ? 'Normal' : 'Speed 2×'}
            </button>
          </div>

          <div className="hr"></div>
          <div className="title">Prestige</div>
          <div className="subtitle">Trade progress for <b>Brand Points</b> to permanently increase your production.</div>
          <div className="row" style={{marginTop:'8px', gap:'8px'}}>
            <button className="btn" onClick={doPrestige} disabled={prestigePoints <= 0}>
              Prestige for <span>{prestigePoints}</span> points
            </button>
            <span className="badge">
              {prestigePoints > 0 
                ? `You'll get ${prestigePoints} brand point(s). Prestiging resets your cash and buildings.`
                : `Earn $500,000 total to unlock prestige.`
              }
            </span>
          </div>
        </section>

        <section>
          <div className="card" style={{marginBottom:'12px'}}>
            <div className="row-split">
              <div className="title">Locations & Equipment</div>
              <div className="subtitle">Invest to generate passive income</div>
            </div>
            <div className="grid">
              {gameState.buildings.map((building: Building) => {
                const cost = building.getCost(gameState.costReduction);
                const rate = building.getRate(gameState.multipliers, gameState.brandPoints);
                
                return (
                  <div key={building.id} className="card">
                    <div className="building">
                      <div className="icon">{building.icon}</div>
                      <div style={{flex:1}}>
                        <h3>{building.name} <span className="muted">x{building.count}</span></h3>
                        <div className="subtitle">Earns <b>+{fmt(rate)}/s</b></div>
                        <div className="progress" style={{marginTop:'8px'}}>
                          <div className="bar" style={{width: pct(building.progress)}}></div>
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{marginTop:'10px', gap:'8px'}}>
                      <button 
                        className="btn" 
                        disabled={gameState.cash < cost}
                        onClick={() => buyBuilding(building.id, gameState.buyMax ? 'max' : 1)}
                      >
                        Buy ( {fmt(cost)} )
                      </button>
                      <button 
                        className="btn-secondary" 
                        disabled={gameState.cash < cost}
                        onClick={() => buyBuilding(building.id, 5)}
                      >
                        +5
                      </button>
                      <button 
                        className="btn-secondary"
                        onClick={() => buyBuilding(building.id, 'max')}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="row-split">
              <div className="title">Upgrades</div>
              <div className="subtitle">Buy permanent improvements</div>
            </div>
            <div className="grid">
              {gameState.upgrades.map((upgrade: Upgrade) => (
                <div key={upgrade.id} className="card" style={{opacity: upgrade.bought ? 0.55 : 1}}>
                  <div className="row-split">
                    <div>
                      <div className="title" style={{margin:'0 0 6px 0'}}>{upgrade.name}</div>
                      <div className="subtitle">{upgrade.desc}</div>
                    </div>
                    <div>
                      <button 
                        className={upgrade.bought ? 'btn-ghost' : 'btn'}
                        disabled={upgrade.bought || gameState.cash < upgrade.cost}
                        onClick={() => buyUpgrade(upgrade.id)}
                      >
                        {upgrade.bought ? 'Purchased' : `Buy (${fmt(upgrade.cost)})`}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <div 
        className={`toast ${toast.show ? 'show' : ''}`}
        style={{
          borderColor: toast.kind === 'warn' ? 'rgba(245,158,11,.55)' : 
                      toast.kind === 'bad' ? 'rgba(239,68,68,.55)' : 
                      'rgba(148,163,184,.35)'
        }}
        dangerouslySetInnerHTML={{ __html: toast.message }}
      />
      
      <div className="footer">
        Built for 1-day production. Theming tip: search the code for <span className="link">THEME</span> and customize icons/names.
      </div>
    </>
  );
};

export default CoffeeCorpTycoon;