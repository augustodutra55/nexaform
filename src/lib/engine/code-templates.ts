/**
 * Biblioteca de apps React reais e jogáveis.
 *
 * Cada template é o código-fonte de um componente `App` executável pelo
 * AppRunner. Servem de fallback gratuito (modo demo) quando não há chave de
 * IA — e provam que o runtime executa apps funcionais de verdade.
 *
 * Regras do código dos templates (para transpilar limpo no iframe):
 * usar apenas aspas simples/duplas (sem template literals ` nem ${}).
 */

export interface CodeTemplate {
  id: string;
  match: RegExp;
  name: string;
  reply: string;
  plan: string[];
  code: string;
}

/* ─────────────────────────── XADREZ ─────────────────────────── */
const CHESS = `
function App() {
  const GLYPH = { K:'\\u2654', Q:'\\u2655', R:'\\u2656', B:'\\u2657', N:'\\u2658', P:'\\u2659', k:'\\u265A', q:'\\u265B', r:'\\u265C', b:'\\u265D', n:'\\u265E', p:'\\u265F' };
  const START = [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R']
  ];
  const clone = function(b){ return b.map(function(r){ return r.slice(); }); };
  const isWhite = function(p){ return p && p === p.toUpperCase(); };
  const colorOf = function(p){ return p ? (isWhite(p) ? 'w' : 'b') : null; };
  const inside = function(r,c){ return r>=0 && r<8 && c>=0 && c<8; };

  const [board, setBoard] = useState(START);
  const [sel, setSel] = useState(null);
  const [turn, setTurn] = useState('w');
  const [captured, setCaptured] = useState({ w: [], b: [] });

  function rayMoves(b, r, c, dirs, one){
    const me = colorOf(b[r][c]); const out = [];
    for (var i=0;i<dirs.length;i++){
      var dr=dirs[i][0], dc=dirs[i][1], nr=r+dr, nc=c+dc;
      while (inside(nr,nc)){
        if (!b[nr][nc]) { out.push([nr,nc]); }
        else { if (colorOf(b[nr][nc])!==me) out.push([nr,nc]); break; }
        if (one) break;
        nr+=dr; nc+=dc;
      }
    }
    return out;
  }
  function legal(b, r, c){
    var p = b[r][c]; if(!p) return [];
    var t = p.toLowerCase(); var me = colorOf(p); var out = [];
    if (t==='p'){
      var dir = me==='w' ? -1 : 1; var start = me==='w' ? 6 : 1;
      if (inside(r+dir,c) && !b[r+dir][c]){ out.push([r+dir,c]);
        if (r===start && !b[r+2*dir][c]) out.push([r+2*dir,c]); }
      var caps=[[dir,-1],[dir,1]];
      for (var i=0;i<caps.length;i++){ var nr=r+caps[i][0], nc=c+caps[i][1];
        if (inside(nr,nc) && b[nr][nc] && colorOf(b[nr][nc])!==me) out.push([nr,nc]); }
      return out;
    }
    if (t==='n'){
      var js=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (var k=0;k<js.length;k++){ var jr=r+js[k][0], jc=c+js[k][1];
        if (inside(jr,jc) && colorOf(b[jr][jc])!==me) out.push([jr,jc]); }
      return out;
    }
    if (t==='b') return rayMoves(b,r,c,[[-1,-1],[-1,1],[1,-1],[1,1]],false);
    if (t==='r') return rayMoves(b,r,c,[[-1,0],[1,0],[0,-1],[0,1]],false);
    if (t==='q') return rayMoves(b,r,c,[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]],false);
    if (t==='k') return rayMoves(b,r,c,[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]],true);
    return out;
  }

  var targets = sel ? legal(board, sel[0], sel[1]) : [];
  var isTarget = function(r,c){ for(var i=0;i<targets.length;i++){ if(targets[i][0]===r&&targets[i][1]===c) return true;} return false; };

  function click(r,c){
    var p = board[r][c];
    if (sel){
      if (isTarget(r,c)){
        var nb = clone(board);
        var moving = nb[sel[0]][sel[1]];
        var taken = nb[r][c];
        if (taken){ var cap = Object.assign({}, captured); cap[turn] = cap[turn].concat([taken]); setCaptured(cap); }
        // promoção simples do peão
        if (moving.toLowerCase()==='p' && (r===0 || r===7)) moving = turn==='w' ? 'Q' : 'q';
        nb[r][c] = moving; nb[sel[0]][sel[1]] = '';
        setBoard(nb); setSel(null); setTurn(turn==='w'?'b':'w');
        return;
      }
      if (p && colorOf(p)===turn){ setSel([r,c]); return; }
      setSel(null); return;
    }
    if (p && colorOf(p)===turn) setSel([r,c]);
  }

  function reset(){ setBoard(START); setSel(null); setTurn('w'); setCaptured({w:[],b:[]}); }

  var files = ['a','b','c','d','e','f','g','h'];
  return (
    React.createElement('div', { className:'min-h-full w-full flex flex-col items-center gap-4 p-6 bg-slate-900 text-slate-100' },
      React.createElement('div', { className:'flex items-center justify-between w-full max-w-md' },
        React.createElement('h1', { className:'text-xl font-bold tracking-tight' }, 'Xadrez'),
        React.createElement('button', { onClick:reset, className:'px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium' }, 'Reiniciar')
      ),
      React.createElement('div', { className:'text-sm text-slate-300' }, 'Vez: ',
        React.createElement('span', { className:'font-semibold' }, turn==='w'?'Brancas':'Pretas')
      ),
      React.createElement('div', { className:'rounded-xl overflow-hidden shadow-2xl border border-slate-700', style:{ width:'min(88vw,440px)' } },
        board.map(function(row, r){
          return React.createElement('div', { key:r, className:'flex' },
            row.map(function(cell, c){
              var dark = (r+c)%2===1;
              var selected = sel && sel[0]===r && sel[1]===c;
              var tgt = isTarget(r,c);
              var bg = dark ? '#6b7280' : '#e5e7eb';
              if (selected) bg = '#6366f1';
              return React.createElement('div', {
                key:c, onClick:function(){ click(r,c); },
                className:'flex items-center justify-center cursor-pointer select-none relative',
                style:{ width:'12.5%', aspectRatio:'1 / 1', background:bg, fontSize:'min(7vw,32px)', lineHeight:1, color: isWhite(cell)?'#f8fafc':'#0f172a', textShadow: isWhite(cell)?'0 1px 1px rgba(0,0,0,0.35)':'none' }
              },
                cell ? GLYPH[cell] : '',
                tgt ? React.createElement('span', { style:{ position:'absolute', width:'26%', height:'26%', borderRadius:'50%', background: board[r][c] ? 'transparent':'rgba(99,102,241,0.7)', boxShadow: board[r][c] ? 'inset 0 0 0 3px rgba(99,102,241,0.9)':'none' } }) : null
              );
            })
          );
        })
      ),
      React.createElement('div', { className:'flex justify-between w-full max-w-md text-2xl' },
        React.createElement('div', {}, captured.w.map(function(x,i){ return React.createElement('span',{key:i},GLYPH[x]); })),
        React.createElement('div', {}, captured.b.map(function(x,i){ return React.createElement('span',{key:i},GLYPH[x]); }))
      ),
      React.createElement('p', { className:'text-xs text-slate-400 text-center max-w-md' }, 'Clique numa peça e depois na casa de destino. Peões viram dama ao chegar na última fileira.')
    )
  );
}
`;

/* ────────────────────────── JOGO DA VELHA ────────────────────────── */
const TICTACTOE = `
function App(){
  const [cells, setCells] = useState(Array(9).fill(null));
  const [xNext, setXNext] = useState(true);
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  var winner=null;
  for (var i=0;i<lines.length;i++){ var a=lines[i][0],b=lines[i][1],c=lines[i][2];
    if (cells[a] && cells[a]===cells[b] && cells[a]===cells[c]) winner=cells[a]; }
  var full = cells.every(function(x){return x;});
  function play(i){ if(cells[i]||winner) return; var n=cells.slice(); n[i]=xNext?'X':'O'; setCells(n); setXNext(!xNext); }
  function reset(){ setCells(Array(9).fill(null)); setXNext(true); }
  var status = winner ? ('Venceu: '+winner) : full ? 'Empate!' : ('Vez de '+(xNext?'X':'O'));
  return React.createElement('div',{className:'min-h-full flex flex-col items-center justify-center gap-5 p-6 bg-slate-900 text-white'},
    React.createElement('h1',{className:'text-2xl font-bold'},'Jogo da Velha'),
    React.createElement('div',{className:'text-slate-300'},status),
    React.createElement('div',{className:'grid grid-cols-3 gap-2'},
      cells.map(function(v,i){ return React.createElement('button',{key:i,onClick:function(){play(i);},
        className:'w-20 h-20 rounded-xl bg-slate-800 hover:bg-slate-700 text-4xl font-bold flex items-center justify-center '+(v==='X'?'text-indigo-400':'text-rose-400')}, v||''); })
    ),
    React.createElement('button',{onClick:reset,className:'px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 font-medium'},'Reiniciar')
  );
}
`;

/* ────────────────────────── CALCULADORA ────────────────────────── */
const CALC = `
function App(){
  const [expr, setExpr] = useState('');
  const [out, setOut] = useState('0');
  var keys = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
  function press(k){
    if (k==='='){ try { var r = Function('return ('+expr.replace(/[^-()\\d/*+.]/g,'')+')')(); setOut(String(r)); } catch(e){ setOut('Erro'); } return; }
    setExpr(expr+k);
  }
  function clear(){ setExpr(''); setOut('0'); }
  return React.createElement('div',{className:'min-h-full flex items-center justify-center p-6 bg-slate-900'},
    React.createElement('div',{className:'w-72 rounded-2xl bg-slate-800 p-4 shadow-2xl'},
      React.createElement('div',{className:'text-right text-slate-400 text-sm h-5 truncate'},expr||' '),
      React.createElement('div',{className:'text-right text-white text-4xl font-semibold mb-3 truncate'},out),
      React.createElement('div',{className:'grid grid-cols-4 gap-2'},
        React.createElement('button',{onClick:clear,className:'col-span-4 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-medium'},'Limpar'),
        keys.map(function(k){ var op = ('/*-+=').indexOf(k)>=0;
          return React.createElement('button',{key:k,onClick:function(){press(k);},
            className:'py-4 rounded-xl text-lg font-medium '+(op?'bg-indigo-500 hover:bg-indigo-400 text-white':'bg-slate-700 hover:bg-slate-600 text-white')}, k); })
      )
    )
  );
}
`;

/* ────────────────────────── LISTA DE TAREFAS ────────────────────────── */
const TODO = `
function App(){
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  function add(){ if(!text.trim())return; setItems(items.concat([{id:Date.now(),t:text.trim(),done:false}])); setText(''); }
  function toggle(id){ setItems(items.map(function(x){ return x.id===id?Object.assign({},x,{done:!x.done}):x; })); }
  function del(id){ setItems(items.filter(function(x){return x.id!==id;})); }
  var left = items.filter(function(x){return !x.done;}).length;
  return React.createElement('div',{className:'min-h-full flex justify-center p-6 bg-slate-900 text-white'},
    React.createElement('div',{className:'w-full max-w-md'},
      React.createElement('h1',{className:'text-2xl font-bold mb-1'},'Minhas tarefas'),
      React.createElement('p',{className:'text-slate-400 text-sm mb-4'},left+' pendente(s)'),
      React.createElement('div',{className:'flex gap-2 mb-4'},
        React.createElement('input',{value:text,onChange:function(e){setText(e.target.value);},onKeyDown:function(e){if(e.key==='Enter')add();},
          placeholder:'Nova tarefa...',className:'flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-indigo-500'}),
        React.createElement('button',{onClick:add,className:'px-4 rounded-lg bg-indigo-500 hover:bg-indigo-400 font-medium'},'Add')
      ),
      React.createElement('ul',{className:'space-y-2'},
        items.map(function(it){ return React.createElement('li',{key:it.id,className:'flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2'},
          React.createElement('input',{type:'checkbox',checked:it.done,onChange:function(){toggle(it.id);},className:'w-4 h-4 accent-indigo-500'}),
          React.createElement('span',{className:'flex-1 '+(it.done?'line-through text-slate-500':'')},it.t),
          React.createElement('button',{onClick:function(){del(it.id);},className:'text-slate-500 hover:text-rose-400'},'\\u2715')
        ); })
      )
    )
  );
}
`;

/* ────────────────────────── POMODORO / TIMER ────────────────────────── */
const TIMER = `
function App(){
  const [secs, setSecs] = useState(25*60);
  const [run, setRun] = useState(false);
  useEffect(function(){
    if(!run) return;
    var id = setInterval(function(){ setSecs(function(s){ return s>0?s-1:0; }); }, 1000);
    return function(){ clearInterval(id); };
  }, [run]);
  var m = Math.floor(secs/60), s = secs%60;
  var fmt = (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
  return React.createElement('div',{className:'min-h-full flex flex-col items-center justify-center gap-6 p-6 bg-slate-900 text-white'},
    React.createElement('h1',{className:'text-xl font-semibold text-slate-300'},'Pomodoro'),
    React.createElement('div',{className:'text-7xl font-bold tabular-nums'},fmt),
    React.createElement('div',{className:'flex gap-3'},
      React.createElement('button',{onClick:function(){setRun(!run);},className:'px-6 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 font-medium'},run?'Pausar':'Iniciar'),
      React.createElement('button',{onClick:function(){setRun(false);setSecs(25*60);},className:'px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium'},'Zerar')
    ),
    React.createElement('div',{className:'flex gap-2'},
      [5,15,25,45].map(function(v){ return React.createElement('button',{key:v,onClick:function(){setRun(false);setSecs(v*60);},
        className:'px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm'}, v+'m'); })
    )
  );
}
`;

export const TEMPLATES: CodeTemplate[] = [
  { id: "chess", match: /xadrez|chess/i, name: "Xadrez", reply: "Criei um xadrez jogável de verdade — clique numa peça e na casa de destino. Peça refinamentos que eu ajusto o código.", plan: ["Interpretar o pedido como jogo de xadrez", "Escrever o componente React do tabuleiro 8×8", "Implementar movimentos legais por peça e capturas", "Renderizar e executar o app no preview"], code: CHESS },
  { id: "tictactoe", match: /jogo da velha|tic.?tac|velha/i, name: "Jogo da Velha", reply: "Fiz um jogo da velha para dois jogadores, com detecção de vitória e empate.", plan: ["Interpretar como jogo da velha", "Montar o tabuleiro 3×3 e o estado", "Detectar vitória/empate", "Executar no preview"], code: TICTACTOE },
  { id: "calc", match: /calculadora|calcular/i, name: "Calculadora", reply: "Montei uma calculadora funcional com as operações básicas.", plan: ["Interpretar como calculadora", "Criar teclado e visor", "Avaliar a expressão", "Executar no preview"], code: CALC },
  { id: "todo", match: /lista de tarefas|to.?do|afazeres|tarefas/i, name: "Lista de tarefas", reply: "Criei uma lista de tarefas com adicionar, concluir e remover.", plan: ["Interpretar como lista de tarefas", "Estado dos itens e input", "Concluir/remover", "Executar no preview"], code: TODO },
  { id: "timer", match: /pomodoro|cron[oô]metro|timer|contador de tempo/i, name: "Pomodoro", reply: "Fiz um timer Pomodoro com iniciar, pausar e presets.", plan: ["Interpretar como timer", "Contagem regressiva com setInterval", "Controles e presets", "Executar no preview"], code: TIMER },
];

export function matchTemplate(prompt: string): CodeTemplate | null {
  for (const t of TEMPLATES) if (t.match.test(prompt)) return t;
  return null;
}
