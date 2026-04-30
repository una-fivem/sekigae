import { useState, useRef, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';
import './App.css';

const STORAGE_KEY = 'seat-shuffle-v1';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function makeSeatArray(rows, cols, prev = []) {
  const arr = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const old = prev.find(s => s.row === r && s.col === c);
      arr.push({
        id: r * cols + c + 1,
        row: r,
        col: c,
        studentId: old?.studentId ?? null,
        studentName: old?.studentName ?? null,
      });
    }
  }
  return arr;
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function App() {
  const saved = useRef(loadSaved());
  const s = saved.current;

  const [rows, setRows] = useState(s?.rows ?? 5);
  const [cols, setCols] = useState(s?.cols ?? 6);
  const [rangeEnabled, setRangeEnabled] = useState(s?.rangeEnabled ?? false);
  const [rangeRows, setRangeRows] = useState(s?.rangeRows ?? 2);
  const [maxHoldTime, setMaxHoldTime] = useState(s?.maxHoldTime ?? 5);
  const [seats, setSeats] = useState(() => s?.seats ?? makeSeatArray(5, 6));
  const [students, setStudents] = useState(s?.students ?? []);
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [hlSeatId, setHlSeatId] = useState(null);
  const [isHolding, setIsHolding] = useState(false);
  const [isDecel, setIsDecel] = useState(false);
  const [grayPhase, setGrayPhase] = useState(false);
  const [confirmedId, setConfirmedId] = useState(null);
  const [status, setStatus] = useState('');
  const [statusErr, setStatusErr] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(s?.darkMode ?? true);
  const [soundEnabled, setSoundEnabled] = useState(s?.soundEnabled ?? true);
  const [confettiEnabled, setConfettiEnabled] = useState(s?.confettiEnabled ?? true);

  // random pick states
  const [isPickRunning, setIsPickRunning] = useState(false);
  const [pickHlId, setPickHlId] = useState(null);
  const [pickedStudent, setPickedStudent] = useState(null);

  // Individual student settings states
  const [contextMenu, setContextMenu] = useState(null); // { x, y, studentId }
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsType, setSettingsType] = useState(null); // 'fixed', 'preferred', 'pair'

  const audioCtxRef = useRef(null);
  const holdIntRef = useRef(null);
  const decelRef = useRef(null);
  const holdTimerRef = useRef(null);
  const grayTRef = useRef(null);
  const confirmTRef = useRef(null);
  const decidedRef = useRef(null);
  const studentRef = useRef(null);
  const availRef = useRef([]);
  const activeRef = useRef(false);
  const pickTimerRef = useRef(null);
  const pickClearRef = useRef(null);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows, cols, seats, students, rangeEnabled, rangeRows, maxHoldTime, 
        darkMode: isDarkMode, soundEnabled, confettiEnabled
      }));
    } catch { }
  }, [rows, cols, seats, students, rangeEnabled, rangeRows, maxHoldTime, isDarkMode, soundEnabled, confettiEnabled]);

  const playTick = useCallback((freq = 800, duration = 0.05) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }, [soundEnabled]);

  const playSuccess = useCallback(() => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const playNote = (f, timeStart, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + timeStart);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + timeStart);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + timeStart + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + timeStart);
        osc.stop(ctx.currentTime + timeStart + duration);
      };
      playNote(523.25, 0, 0.15); // C5
      playNote(659.25, 0.1, 0.15); // E5
      playNote(783.99, 0.2, 0.15); // G5
      playNote(1046.50, 0.3, 0.6); // C6
    } catch (e) {}
  }, [soundEnabled]);

  // dark mode toggle
  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  // cleanup
  useEffect(() => () => {
    clearInterval(holdIntRef.current);
    clearTimeout(decelRef.current);
    clearTimeout(holdTimerRef.current);
    clearTimeout(grayTRef.current);
    clearTimeout(confirmTRef.current);
    clearTimeout(pickTimerRef.current);
    clearTimeout(pickClearRef.current);
  }, []);

  const isSpinning = isHolding || isDecel || grayPhase;

  // helpers
  const getAvailable = useCallback(() =>
    seats.filter(st => !st.studentId && (!rangeEnabled || st.row < rangeRows))
    , [seats, rangeEnabled, rangeRows]);

  const isAssigned = (sid) => seats.some(st => st.studentId === sid);
  const seatOf = (sid) => seats.find(st => st.studentId === sid);

  // grid change
  function changeGrid(nr, nc) {
    nr = Math.max(1, Math.min(10, nr));
    nc = Math.max(1, Math.min(10, nc));
    setRows(nr); setCols(nc);
    setSeats(prev => makeSeatArray(nr, nc, prev));
  }

  // student mgmt
  function addStudent() {
    const name = newName.trim();
    if (!name) return;
    setStudents(p => [...p, { 
      id: genId(), 
      name,
      fixedSeat: null,
      preferredSeats: [],
      pairWith: null,
      avoidWith: null
    }]);
    setNewName('');
  }
  function removeStudent(id) {
    setStudents(p => {
      const filtered = p.filter(x => x.id !== id);
      // Remove references from others
      return filtered.map(s => (s.pairWith === id || s.avoidWith === id) ? { ...s, pairWith: null, avoidWith: null } : s);
    });
    setSeats(p => p.map(x => x.studentId === id ? { ...x, studentId: null, studentName: null } : x));
    if (selectedId === id) setSelectedId(null);
    if (contextMenu?.studentId === id) setContextMenu(null);
  }

  // context menu handlers
  function handleContextMenu(e, studentId) {
    e.preventDefault();
    if (isSpinning || isPickRunning) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      studentId
    });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  useEffect(() => {
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, []);

  function updateStudentSetting(id, updates) {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  function openSettingsModal(type) {
    setSettingsType(type);
    setEditingStudentId(contextMenu.studentId);
    setIsSettingsModalOpen(true);
    setContextMenu(null);
  }

  function setAvoid(avoidId) {
    const student = students.find(s => s.id === editingStudentId);
    if (!student) return;

    if (student.avoidWith) {
      updateStudentSetting(student.avoidWith, { avoidWith: null });
    }

    if (avoidId) {
      updateStudentSetting(editingStudentId, { avoidWith: avoidId });
      updateStudentSetting(avoidId, { avoidWith: editingStudentId });
    } else {
      updateStudentSetting(editingStudentId, { avoidWith: null });
    }
    setIsSettingsModalOpen(false);
  }

  function togglePreferredSeat(seatId) {
    const student = students.find(s => s.id === editingStudentId);
    if (!student) return;
    const current = student.preferredSeats || [];
    const next = current.includes(seatId)
      ? current.filter(id => id !== seatId)
      : [...current, seatId];
    updateStudentSetting(editingStudentId, { preferredSeats: next, fixedSeat: null });
  }

  function setFixedSeat(seatId) {
    updateStudentSetting(editingStudentId, { fixedSeat: seatId, preferredSeats: [] });
    setIsSettingsModalOpen(false);
  }

  function setPair(pairId) {
    const student = students.find(s => s.id === editingStudentId);
    if (!student) return;

    // Remove old bidirectional pair
    if (student.pairWith) {
      updateStudentSetting(student.pairWith, { pairWith: null });
    }

    if (pairId) {
      // Set bidirectional pair
      updateStudentSetting(editingStudentId, { pairWith: pairId });
      updateStudentSetting(pairId, { pairWith: editingStudentId });
    } else {
      updateStudentSetting(editingStudentId, { pairWith: null });
    }
    setIsSettingsModalOpen(false);
  }

  function clearSettings(studentId) {
    const student = students.find(s => s.id === studentId);
    if (student?.pairWith) {
      updateStudentSetting(student.pairWith, { pairWith: null });
    }
    updateStudentSetting(studentId, { fixedSeat: null, preferredSeats: [], pairWith: null, avoidWith: null });
    setContextMenu(null);
  }

  function triggerConfetti() {
    if (!confettiEnabled) return;
    const end = Date.now() + 3 * 1000;
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    (function frame() {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    }());
  }

  const checkAllFilled = (nextSeats) => {
    const filled = nextSeats.filter(s => !!s.studentId).length;
    if (filled === students.length && students.length > 0) {
      setTimeout(triggerConfetti, 500);
    }
  };

  // spin start
  function handleSpinStart(e) {
    e.preventDefault();
    if (activeRef.current) return;
    if (!selectedId) {
      setStatus('生徒を選択してください'); setStatusErr(true);
      setTimeout(() => { setStatus(''); setStatusErr(false); }, 2000);
      return;
    }
    if (isAssigned(selectedId)) {
      setStatus('この生徒はすでに配置済みです'); setStatusErr(true);
      setTimeout(() => { setStatus(''); setStatusErr(false); }, 2000);
      return;
    }
    const student = students.find(x => x.id === selectedId);
    if (!student) return;

    let avail = getAvailable();
    if (avail.length === 0) {
      setStatus('空いている席がありません'); setStatusErr(true);
      setTimeout(() => { setStatus(''); setStatusErr(false); }, 2000);
      return;
    }

    let targetSeat;
    // 1. Check fixed seat
    if (student.fixedSeat) {
      const fixed = avail.find(s => s.id === student.fixedSeat);
      if (fixed) {
        targetSeat = fixed;
      }
    }

    // 2. Check preferred seats if no target yet
    if (!targetSeat && student.preferredSeats && student.preferredSeats.length > 0) {
      const preferredAvail = avail.filter(s => student.preferredSeats.includes(s.id));
      if (preferredAvail.length > 0) {
        targetSeat = preferredAvail[Math.floor(Math.random() * preferredAvail.length)];
      }
    }

    // 3. Normal random
    if (!targetSeat) {
      targetSeat = avail[Math.floor(Math.random() * avail.length)];
    }

    decidedRef.current = targetSeat.id;
    studentRef.current = student;
    availRef.current = avail;
    activeRef.current = true;
    setIsHolding(true); setStatus(''); setStatusErr(false); setConfirmedId(null);

    holdIntRef.current = setInterval(() => {
      const r = avail[Math.floor(Math.random() * avail.length)];
      setHlSeatId(r.id);
      playTick(1200, 0.03);
    }, 80);

    holdTimerRef.current = setTimeout(() => doSpinEnd(), maxHoldTime * 1000);
  }

  // spin end
  function doSpinEnd() {
    if (!activeRef.current) return;
    clearInterval(holdIntRef.current);
    clearTimeout(holdTimerRef.current);
    setIsHolding(false);
    setGrayPhase(true); setHlSeatId(null);

    grayTRef.current = setTimeout(() => {
      setGrayPhase(false); setIsDecel(true);
      const avail = availRef.current;
      const targetId = decidedRef.current;
      if (avail.length === 0 || !targetId) { activeRef.current = false; setIsDecel(false); return; }

      const total = 20; // 減速フェーズのランダムステップ数
      const teaseJumps = Math.floor(Math.random() * 2) + 2; // 最後2〜3回
      let step = 0;
      let lastId = null;

      function tick() {
        if (step >= total) {
          // 当選先に止めて2秒溜める
          setHlSeatId(targetId);
          playTick(800, 0.05);
          decelRef.current = setTimeout(() => {
            playSuccess();
            setIsDecel(false); setConfirmedId(targetId);
            const stu = studentRef.current;
            if (stu) {
              setSeats(p => {
                const next = p.map(x => x.id === targetId ? { ...x, studentId: stu.id, studentName: stu.name } : x);
                checkAllFilled(next);
                return next;
              });
              setStatus(`「${stu.name}」→ 席${targetId} に決定！`);
            }
            setSelectedId(null); activeRef.current = false;
            confirmTRef.current = setTimeout(() => { setConfirmedId(null); setStatus(''); }, 3000);
          }, 2000);
          return;
        }

        // 完全にランダムに移動させる（同じ席が連続しないよう調整）
        let randomSeat;
        if (avail.length > 1) {
          do {
            randomSeat = avail[Math.floor(Math.random() * avail.length)];
          } while (randomSeat.id === lastId);
        } else {
          randomSeat = avail[0];
        }
        lastId = randomSeat.id;

        setHlSeatId(randomSeat.id);
        playTick(800, 0.05); // カチッという音
        
        let delay;
        const remaining = total - step;
        if (remaining <= teaseJumps) {
          // 最後の2〜3回は1秒〜2秒のランダムな溜め（焦らし）
          delay = 1000 + Math.random() * 1000;
        } else {
          const prog = step / (total - teaseJumps);
          const clampedProg = Math.min(prog, 1);
          // それまでは二次曲線的に減速
          delay = 40 + Math.pow(clampedProg, 2.5) * 500;
        }

        step++;
        decelRef.current = setTimeout(tick, delay);
      }
      tick();
    }, 300);
  }

  function handleSpinEnd(e) {
    if (e) e.preventDefault();
    doSpinEnd();
  }

  // bulk assign
  function bulkAssign() {
    const unassigned = students.filter(st => !isAssigned(st.id));
    if (unassigned.length === 0) return;

    setSeats(prev => {
      let next = [...prev];
      let remainingStudents = [...unassigned];

      function assign(student, seatId) {
        const idx = next.findIndex(s => s.id === seatId);
        if (idx === -1) return false;
        next[idx] = { ...next[idx], studentId: student.id, studentName: student.name };
        remainingStudents = remainingStudents.filter(s => s.id !== student.id);
        return true;
      }

      function isSeatFree(sid) {
        return !next.find(s => s.id === sid)?.studentId;
      }

      function getFreeAvail() {
        return next.filter(s => !s.studentId && (!rangeEnabled || s.row < rangeRows));
      }

      // 1. Fixed Seats
      remainingStudents.filter(s => s.fixedSeat).forEach(s => {
        if (isSeatFree(s.fixedSeat)) {
          assign(s, s.fixedSeat);
        }
      });

      // 2. Pairs
      // Process pairs where one is already assigned or both are unassigned
      let pairProcessed = new Set();
      remainingStudents.filter(s => s.pairWith).forEach(s => {
        if (pairProcessed.has(s.id)) return;
        const pair = remainingStudents.find(p => p.id === s.pairWith);
        if (!pair) return;

        const free = getFreeAvail().sort(() => Math.random() - 0.5);
        if (free.length < 2) return;

        // Try to find two adjacent seats
        let found = false;
        for (let s1 of free) {
          const adj = free.find(s2 => 
            s2.id !== s1.id && 
            Math.abs(s2.row - s1.row) + Math.abs(s2.col - s1.col) === 1
          );
          if (adj) {
            assign(s, s1.id);
            assign(pair, adj.id);
            pairProcessed.add(s.id);
            pairProcessed.add(pair.id);
            found = true;
            break;
          }
        }
      });

      // 3. Avoids (Simple swap logic)
      // Note: This is a best-effort simple implementation
      remainingStudents.filter(s => s.avoidWith).forEach(s => {
        // Find if they are neighbors
        const sSeat = next.find(ns => ns.studentId === s.id);
        const avoidSeat = next.find(ns => ns.studentId === s.avoidWith);
        if (sSeat && avoidSeat) {
          const dist = Math.abs(sSeat.row - avoidSeat.row) + Math.abs(sSeat.col - avoidSeat.col);
          if (dist === 1) {
            // Swap s with a random free seat if possible
            const free = getFreeAvail();
            if (free.length > 0) {
              const target = free[Math.floor(Math.random() * free.length)];
              const idxS = next.findIndex(ns => ns.id === sSeat.id);
              const idxT = next.findIndex(ns => ns.id === target.id);
              next[idxT] = { ...next[idxT], studentId: s.id, studentName: s.name };
              next[idxS] = { ...next[idxS], studentId: null, studentName: null };
            }
          }
        }
      });

      // 4. Preferred Seats
      remainingStudents.filter(s => s.preferredSeats?.length > 0).forEach(s => {
        const freePref = getFreeAvail().filter(seat => s.preferredSeats.includes(seat.id));
        if (freePref.length > 0) {
          const target = freePref[Math.floor(Math.random() * freePref.length)];
          assign(s, target.id);
        }
      });

      // 5. Remaining Random
      const finalFree = getFreeAvail().sort(() => Math.random() - 0.5);
      const finalStus = [...remainingStudents].sort(() => Math.random() - 0.5);
      const pairsCount = Math.min(finalFree.length, finalStus.length);
      for (let i = 0; i < pairsCount; i++) {
        assign(finalStus[i], finalFree[i].id);
      }

      checkAllFilled(next);
      return next;
    });
  }

  // drag & drop
  function handleDragStart(e, seatId) {
    if (isSpinning) return;
    const seat = seats.find(s => s.id === seatId);
    if (!seat?.studentId) return;
    e.dataTransfer.setData('text/plain', seatId);
  }
  function handleDragOver(e) {
    e.preventDefault();
  }
  function handleDrop(e, targetId) {
    e.preventDefault();
    const sourceId = parseInt(e.dataTransfer.getData('text/plain'));
    if (sourceId === targetId) return;

    setSeats(prev => {
      const next = [...prev];
      const sIdx = next.findIndex(s => s.id === sourceId);
      const tIdx = next.findIndex(s => s.id === targetId);
      const sSeat = next[sIdx];
      const tSeat = next[tIdx];

      next[sIdx] = { ...sSeat, studentId: tSeat.studentId, studentName: tSeat.studentName };
      next[tIdx] = { ...tSeat, studentId: sSeat.studentId, studentName: sSeat.studentName };
      return next;
    });
    playTick(600, 0.1);
  }

  async function saveAsImage() {
    const el = document.querySelector('.center-area');
    if (!el) return;
    setStatus('画像を生成中...');
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
        scale: 2
      });
      const link = document.createElement('a');
      link.download = `座席表_${new Date().toLocaleDateString()}.png`;
      link.href = canvas.toDataURL();
      link.click();
      setStatus('画像を保存しました');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setStatus('保存に失敗しました');
    }
  }

  // reset
  function resetSeats() {
    setSeats(p => p.map(x => ({ ...x, studentId: null, studentName: null })));
    setSelectedId(null); setHlSeatId(null); setConfirmedId(null); setStatus('');
    setPickHlId(null); setPickedStudent(null);
  }

  // seat class
  function seatClass(seat) {
    const cls = ['seat'];
    if (confirmedId === seat.id) cls.push('confirmed');
    else if (hlSeatId === seat.id) cls.push('highlight');
    else if (grayPhase && !seat.studentId) cls.push('grayed');
    else if (seat.studentId) cls.push('assigned');
    if (rangeEnabled && seat.row >= rangeRows && !seat.studentId) cls.push('out-of-range');
    return cls.join(' ');
  }

  // random pick
  function handleRandomPick() {
    if (students.length === 0 || isPickRunning || isSpinning) return;
    setPickedStudent(null);
    setIsPickRunning(true);

    const target = students[Math.floor(Math.random() * students.length)];
    const total = 20;
    const teaseJumps = Math.floor(Math.random() * 2) + 2;
    let step = 0;
    let lastId = null;

    function tick() {
      if (step >= total) {
        // 当選者に止めて2秒溜める
        setPickHlId(target.id);
        playTick(1000, 0.03);
        pickTimerRef.current = setTimeout(() => {
          playSuccess();
          setPickedStudent(target);
          setIsPickRunning(false);
          pickClearRef.current = setTimeout(() => {
            setPickHlId(null);
            setPickedStudent(null);
          }, 5000);
        }, 2000);
        return;
      }

      let pick;
      if (students.length > 1) {
        do {
          pick = students[Math.floor(Math.random() * students.length)];
        } while (pick.id === lastId);
      } else {
        pick = students[0];
      }
      lastId = pick.id;
      setPickHlId(pick.id);
      playTick(1000, 0.03);

      let delay;
      const remaining = total - step;
      if (remaining <= teaseJumps) {
        // 最後の2〜3回は1秒〜2秒のランダムな溜め（焦らし）
        delay = 1000 + Math.random() * 1000;
      } else {
        const prog = step / (total - teaseJumps);
        const clampedProg = Math.min(prog, 1);
        delay = 40 + Math.pow(clampedProg, 2.5) * 400;
      }
      step++;
      pickTimerRef.current = setTimeout(tick, delay);
    }
    tick();
  }

  const assignedCount = students.filter(st => isAssigned(st.id)).length;
  const selectedStudent = students.find(x => x.id === selectedId);

  return (
    <div className="app">
      <header className="header">
        <h1>席替えツール</h1>
        <div className="header-actions">
          <button className="settings-toggle" onClick={() => setIsDarkMode(p => !p)}>
            {isDarkMode ? 'ライト' : 'ダーク'}
          </button>
          <button className="settings-toggle" onClick={() => setSettingsOpen(p => !p)}>
            ⚙ 設定
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>設定</h3>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} title="閉じる">×</button>
            </div>
            <div className="settings-grid">
              <div className="setting-item">
                <label>行数</label>
                <input type="number" min={1} max={10} value={rows}
                  onChange={e => changeGrid(+e.target.value, cols)} />
              </div>
              <div className="setting-item">
                <label>列数</label>
                <input type="number" min={1} max={10} value={cols}
                  onChange={e => changeGrid(rows, +e.target.value)} />
              </div>
              <div className="setting-item">
                <label>最大長押し時間（秒）</label>
                <input type="number" min={1} max={30} value={maxHoldTime}
                  onChange={e => setMaxHoldTime(Math.max(1, +e.target.value))} />
              </div>
              <div className="setting-row" onClick={() => setRangeEnabled(!rangeEnabled)}>
                <label className="setting-label">範囲制限を有効にする</label>
                <label className="ios-switch" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={rangeEnabled}
                    onChange={e => setRangeEnabled(e.target.checked)} />
                  <span className="slider"></span>
                </label>
              </div>
              <div className="setting-row" onClick={() => setConfettiEnabled(!confettiEnabled)}>
                <label className="setting-label">紙吹雪を有効にする</label>
                <label className="ios-switch" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={confettiEnabled}
                    onChange={e => setConfettiEnabled(e.target.checked)} />
                  <span className="slider"></span>
                </label>
              </div>
              {rangeEnabled && (
                <div className="range-row">
                  <label>前から</label>
                  <input type="number" min={1} max={rows} value={rangeRows}
                    onChange={e => setRangeRows(Math.max(1, Math.min(rows, +e.target.value)))} />
                  <label>行目まで</label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="main-content">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <span>生徒一覧</span>
            <span className="sidebar-count">{assignedCount}/{students.length}</span>
          </div>
          <div className="student-input-row">
            <input
              placeholder="名前を入力"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addStudent()}
            />
            <button onClick={addStudent}>追加</button>
          </div>
          <div className="student-list">
            {students.length === 0 && (
              <div className="student-list-empty">生徒を追加してください</div>
            )}
            {students.map(st => {
              const done = isAssigned(st.id);
              const seatNum = seatOf(st.id)?.id;
              const hasFixed = !!st.fixedSeat;
              const hasPref = st.preferredSeats?.length > 0;
              const hasPair = !!st.pairWith;
              const hasAvoid = !!st.avoidWith;
              return (
                <div
                  key={st.id}
                  className={`student-item ${selectedId === st.id ? 'selected' : ''} ${done ? 'assigned' : ''} ${pickHlId === st.id ? (pickedStudent?.id === st.id ? 'pick-confirmed' : 'pick-highlight') : ''}`}
                  onClick={() => { if (!isSpinning && !isPickRunning && !done) setSelectedId(selectedId === st.id ? null : st.id); }}
                  onContextMenu={(e) => handleContextMenu(e, st.id)}
                >
                  <div className="student-name-container">
                    <span className="student-name">{st.name}</span>
                    <div className="student-settings-badges">
                      {hasFixed && <span title="固定席" className="setting-badge">📌</span>}
                      {hasPref && <span title="優先席" className="setting-badge">⭐</span>}
                      {hasPair && <span title="ペア設定" className="setting-badge">🤝</span>}
                      {hasAvoid && <span title="除外設定" className="setting-badge">🚫</span>}
                    </div>
                  </div>
                  {done
                    ? <span className="student-badge done">席{seatNum}</span>
                    : <span className="student-badge unassigned">未配置</span>
                  }
                  <button className="student-remove" onClick={e => { e.stopPropagation(); removeStudent(st.id); }} title="削除">×</button>
                </div>
              );
            })}
          </div>
          <div className="pick-section">
            <button
              className="pick-button"
              onClick={handleRandomPick}
              disabled={students.length === 0 || isPickRunning || isSpinning}
            >
              {isPickRunning ? '抽選中…' : '🎲 ランダム指名'}
            </button>
            {pickedStudent && (
              <div className="pick-result">
                <span className="pick-result-label">指名：</span>
                <span className="pick-result-name">{pickedStudent.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Center */}
        <div className="center-area">
          <div className="blackboard">黒 板</div>
          <div className="grid-wrapper">
            <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
              {seats.map(seat => (
                <div 
                  key={seat.id} 
                  className={seatClass(seat)}
                  draggable={!!seat.studentId && !isSpinning}
                  onDragStart={(e) => handleDragStart(e, seat.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, seat.id)}
                >
                  <span className="seat-number">{seat.id}</span>
                  {seat.studentName && <span className="seat-student">{seat.studentName}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="spin-section">
            <div className={`spin-status ${statusErr ? 'error' : ''}`}>
              {status || (selectedStudent
                ? <span>「<span className="student-label">{selectedStudent.name}</span>」を選択中</span>
                : '生徒を選んでスピンボタンを長押し'
              )}
            </div>
            <button
              className={`spin-button ${isHolding ? 'holding' : ''}`}
              disabled={isSpinning && !isHolding}
              onMouseDown={!isSpinning ? handleSpinStart : undefined}
              onMouseUp={isHolding ? handleSpinEnd : undefined}
              onMouseLeave={isHolding ? handleSpinEnd : undefined}
              onTouchStart={!isSpinning ? handleSpinStart : undefined}
              onTouchEnd={isHolding ? handleSpinEnd : undefined}
            >
              {isHolding ? '長押し中…' : isDecel || grayPhase ? '抽選中…' : 'スピン'}
            </button>
          </div>

          <div className="action-bar">
            <button onClick={bulkAssign} disabled={isSpinning}>全員ランダム配置</button>
            <button onClick={saveAsImage} disabled={isSpinning}>📸 画像として保存</button>
            <button className="danger-btn" onClick={resetSeats} disabled={isSpinning}>リセット</button>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="context-menu" 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => openSettingsModal('fixed')}>📌 固定席を設定</button>
          <button onClick={() => openSettingsModal('preferred')}>⭐ 優先席を設定</button>
          <button onClick={() => openSettingsModal('pair')}>🤝 ペアを設定</button>
          <button onClick={() => openSettingsModal('avoid')}>🚫 離す人を設定</button>
          <div className="menu-divider"></div>
          <button className="menu-danger" onClick={() => clearSettings(contextMenu.studentId)}>✕ 設定をクリア</button>
        </div>
      )}

      {/* Individual Settings Modal */}
      {isSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {settingsType === 'fixed' && '固定席を選択'}
                {settingsType === 'preferred' && '優先席を選択（複数可）'}
                {settingsType === 'pair' && 'ペア相手を選択'}
                {settingsType === 'avoid' && '離す相手を選択'}
              </h3>
              <button className="modal-close" onClick={() => setIsSettingsModalOpen(false)}>×</button>
            </div>

            <div className="modal-body">
              {['pair', 'avoid'].includes(settingsType) ? (
                <div className="pair-select-list">
                  <button 
                    className="pair-item none" 
                    onClick={() => settingsType === 'pair' ? setPair(null) : setAvoid(null)}
                  >
                    解除する
                  </button>
                  {students.filter(s => s.id !== editingStudentId).map(s => {
                    const student = students.find(e => e.id === editingStudentId);
                    const isActive = settingsType === 'pair' 
                      ? student?.pairWith === s.id 
                      : student?.avoidWith === s.id;
                    return (
                      <button 
                        key={s.id} 
                        className={`pair-item ${isActive ? 'active' : ''}`}
                        onClick={() => settingsType === 'pair' ? setPair(s.id) : setAvoid(s.id)}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="seat-selector-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                  {seats.map(seat => {
                    const student = students.find(s => s.id === editingStudentId);
                    const isFixed = student?.fixedSeat === seat.id;
                    const isPref = student?.preferredSeats?.includes(seat.id);
                    const isOutOfRange = rangeEnabled && seat.row >= rangeRows;

                    return (
                      <div 
                        key={seat.id} 
                        className={`selector-seat ${isFixed ? 'fixed' : ''} ${isPref ? 'preferred' : ''} ${isOutOfRange ? 'out-of-range' : ''}`}
                        onClick={() => settingsType === 'fixed' ? setFixedSeat(seat.id) : togglePreferredSeat(seat.id)}
                      >
                        {seat.id}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {settingsType === 'preferred' && (
              <div className="modal-footer">
                <button className="primary-btn" onClick={() => setIsSettingsModalOpen(false)}>完了</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
