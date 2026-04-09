import { useState, useRef, useEffect, useCallback } from 'react';
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

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows, cols, seats, students, rangeEnabled, rangeRows, maxHoldTime, darkMode: isDarkMode, soundEnabled
      }));
    } catch { }
  }, [rows, cols, seats, students, rangeEnabled, rangeRows, maxHoldTime, isDarkMode, soundEnabled]);

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
    setStudents(p => [...p, { id: genId(), name }]);
    setNewName('');
  }
  function removeStudent(id) {
    setStudents(p => p.filter(x => x.id !== id));
    setSeats(p => p.map(x => x.studentId === id ? { ...x, studentId: null, studentName: null } : x));
    if (selectedId === id) setSelectedId(null);
  }

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
    const avail = getAvailable();
    if (avail.length === 0) {
      setStatus('空いている席がありません'); setStatusErr(true);
      setTimeout(() => { setStatus(''); setStatusErr(false); }, 2000);
      return;
    }
    // decide NOW
    const decided = avail[Math.floor(Math.random() * avail.length)];
    decidedRef.current = decided.id;
    studentRef.current = students.find(x => x.id === selectedId);
    availRef.current = avail;
    activeRef.current = true;
    setIsHolding(true); setStatus(''); setStatusErr(false); setConfirmedId(null);

    holdIntRef.current = setInterval(() => {
      const r = avail[Math.floor(Math.random() * avail.length)];
      setHlSeatId(r.id);
      playTick(1200, 0.03); // 高めの速い音
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
          playSuccess();
          setHlSeatId(targetId); setIsDecel(false); setConfirmedId(targetId);
          const stu = studentRef.current;
          if (stu) {
            setSeats(p => p.map(x => x.id === targetId ? { ...x, studentId: stu.id, studentName: stu.name } : x));
            setStatus(`「${stu.name}」→ 席${targetId} に決定！`);
          }
          setSelectedId(null); activeRef.current = false;
          confirmTRef.current = setTimeout(() => { setConfirmedId(null); setStatus(''); }, 3000);
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
          // 最後の2〜3回は1秒〜5秒のランダムな溜め（焦らし）
          delay = 1000 + Math.random() * 4000;
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
    const avail = getAvailable();
    const shuffS = [...unassigned].sort(() => Math.random() - 0.5);
    const shuffA = [...avail].sort(() => Math.random() - 0.5);
    const pairs = Math.min(shuffS.length, shuffA.length);
    setSeats(prev => {
      const next = [...prev];
      for (let i = 0; i < pairs; i++) {
        const idx = next.findIndex(x => x.id === shuffA[i].id);
        if (idx !== -1) next[idx] = { ...next[idx], studentId: shuffS[i].id, studentName: shuffS[i].name };
      }
      return next;
    });
  }

  // reset
  function resetSeats() {
    setSeats(p => p.map(x => ({ ...x, studentId: null, studentName: null })));
    setSelectedId(null); setHlSeatId(null); setConfirmedId(null); setStatus('');
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
              <div className="setting-row" onClick={() => setSoundEnabled(!soundEnabled)}>
                <label className="setting-label">サウンドを有効にする</label>
                <label className="ios-switch" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={soundEnabled}
                    onChange={e => setSoundEnabled(e.target.checked)} />
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
              return (
                <div
                  key={st.id}
                  className={`student-item ${selectedId === st.id ? 'selected' : ''} ${done ? 'assigned' : ''}`}
                  onClick={() => { if (!isSpinning && !done) setSelectedId(selectedId === st.id ? null : st.id); }}
                >
                  <span className="student-name">{st.name}</span>
                  {done
                    ? <span className="student-badge done">席{seatNum}</span>
                    : <span className="student-badge unassigned">未配置</span>
                  }
                  <button className="student-remove" onClick={e => { e.stopPropagation(); removeStudent(st.id); }} title="削除">×</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center */}
        <div className="center-area">
          <div className="blackboard">黒 板</div>
          <div className="grid-wrapper">
            <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {seats.map(seat => (
                <div key={seat.id} className={seatClass(seat)}>
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
            <button className="danger-btn" onClick={resetSeats} disabled={isSpinning}>リセット</button>
          </div>
        </div>
      </div>
    </div>
  );
}
