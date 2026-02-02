/* League UI - vanilla JS, localStorage persistence
   Features: multi-league, seasons, divisions, teams editable (name/logo/comment),
   standings with colors, schedule generation, results entry, club list & detail,
   season history snapshot per division.
*/
(() => {
  'use strict';

  const STORAGE_KEY = 'league-ui-v1';
  const nowId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const byId = (id) => document.getElementById(id);

  const toastEl = byId('toast');
  let toastTimer = null;
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> toastEl.style.opacity = '0', 1700);
  }

  // --- Data model
  // db = { leagues:[...], selected:{leagueId, seasonId, divisionId, tab, round} }
  // League: {id,name,logoDataUrl, seasons:[Season]}
  // Season: {id,name, createdAt, endedAt|null, divisions:[Division], history:{[divisionId]: [Snapshot] } }
  // Division: {id,name, logoDataUrl, teams:[Team], matches:[Match], rankColors:[{from,to,color,label}] , lastRankMap?:{}}
  // Team: {id,name, logoDataUrl, comment}
  // Match: {id, round, homeId, awayId, homeGoals|null, awayGoals|null, playedAt|null}

  function defaultDB(){
    const leagueId = nowId();
    const seasonId = nowId();
    const divId = nowId();

    const teams = Array.from({length: 8}).map((_,i)=>({
      id: nowId(),
      name: `Team${i+1}`,
      logoDataUrl: '',
      comment: ''
    }));

    return {
      leagues: [{
        id: leagueId,
        name: '同盟戦α',
        logoDataUrl: '',
        seasons: [{
          id: seasonId,
          name: 'Season 1',
          createdAt: Date.now(),
          endedAt: null,
          divisions: [{
            id: divId,
            name: 'Div.1',
            logoDataUrl: '',
            teams,
            matches: [],
            rankColors: [
              { from: 1, to: 1, color: '#FFD94A', label: '優勝' },
              { from: 2, to: 4, color: '#6EF2FF', label: '昇格/PO' },
              { from: 7, to: 7, color: '#FFB84A', label: '入れ替え戦' },
              { from: 8, to: 8, color: '#FF6A6A', label: '降格' }
            ],
            lastRankMap: {}
          }],
          history: {} // divisionId -> snapshots
        }]
      }],
      selected: { leagueId, seasonId, divisionId: divId, tab:'standings', round: 1 }
    };
  }

  function loadDB(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultDB();
      const db = JSON.parse(raw);
      // minimal validation
      if(!db || !Array.isArray(db.leagues) || !db.selected) return defaultDB();
      return db;
    }catch(e){
      return defaultDB();
    }
  }

  let db = loadDB();

  function saveDB(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  // --- Helpers
  function getLeague(){
    return db.leagues.find(l=>l.id===db.selected.leagueId) || db.leagues[0];
  }
  function getSeason(){
    const league = getLeague();
    return league.seasons.find(s=>s.id===db.selected.seasonId) || league.seasons[0];
  }
  function getDivision(){
    const season = getSeason();
    return season.divisions.find(d=>d.id===db.selected.divisionId) || season.divisions[0];
  }
  function getTeam(teamId){
    const div = getDivision();
    return div.teams.find(t=>t.id===teamId);
  }
  function allTeamsAcrossSeason(){
    const season = getSeason();
    const map = new Map();
    for(const div of season.divisions){
      for(const t of div.teams) map.set(t.id, {team:t, division:div});
    }
    return map;
  }

  function setLogo(imgEl, fallbackEl, dataUrl){
    if(dataUrl){
      imgEl.src = dataUrl;
      imgEl.style.display = 'block';
      if(fallbackEl) fallbackEl.style.display = 'none';
    }else{
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
      if(fallbackEl) fallbackEl.style.display = 'grid';
    }
  }

  function readFileAsDataURL(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('file read error'));
      fr.readAsDataURL(file);
    });
  }

  // --- Standings calc
  function computeTable(div){
    const teams = div.teams;
    const stats = new Map();
    for(const t of teams){
      stats.set(t.id, { id:t.id, name:t.name, team:t, played:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0, form:[] });
    }

    // Build match lists per team for form calc
    const playedMatches = div.matches.filter(m=>m.homeGoals!=null && m.awayGoals!=null).sort((a,b)=>{
      // sort by playedAt then round
      const pa = a.playedAt || 0, pb = b.playedAt || 0;
      if(pa!==pb) return pa - pb;
      return a.round - b.round;
    });

    for(const m of playedMatches){
      const hs = stats.get(m.homeId);
      const as = stats.get(m.awayId);
      if(!hs || !as) continue;
      hs.played++; as.played++;
      hs.gf += m.homeGoals; hs.ga += m.awayGoals;
      as.gf += m.awayGoals; as.ga += m.homeGoals;
      if(m.homeGoals > m.awayGoals){
        hs.w++; hs.pts += 3; as.l++;
        hs.form.push('w'); as.form.push('l');
      }else if(m.homeGoals < m.awayGoals){
        as.w++; as.pts += 3; hs.l++;
        as.form.push('w'); hs.form.push('l');
      }else{
        hs.d++; as.d++; hs.pts += 1; as.pts += 1;
        hs.form.push('d'); as.form.push('d');
      }
    }

    for(const s of stats.values()){
      s.gd = s.gf - s.ga;
      // last 5
      s.form = s.form.slice(-5).reverse(); // newest first
    }

    const arr = Array.from(stats.values());
    arr.sort((a,b)=>{
      if(b.pts!==a.pts) return b.pts-a.pts;
      if(b.gd!==a.gd) return b.gd-a.gd;
      if(b.gf!==a.gf) return b.gf-a.gf;
      return a.name.localeCompare(b.name);
    });
    // add rank
    arr.forEach((s,i)=> s.rank=i+1);
    return arr;
  }

  function rankBandColor(div, rank){
    for(const r of div.rankColors || []){
      if(rank>=r.from && rank<=r.to) return r.color;
    }
    return '';
  }

  function arrowForRank(div, teamId, newRank){
    const last = div.lastRankMap || {};
    const oldRank = last[teamId];
    if(oldRank==null) return { cls:'same', text:'→' };
    if(newRank < oldRank) return { cls:'up', text:'▲' };
    if(newRank > oldRank) return { cls:'down', text:'▼' };
    return { cls:'same', text:'→' };
  }

  // --- Schedule generation (circle method)
  function generateRoundRobin(teams, opts){
    // opts: { doubleRound:boolean, homeAway:boolean }
    const ids = teams.map(t=>t.id);
    if(ids.length < 2) return [];
    const isOdd = ids.length % 2 === 1;
    const list = ids.slice();
    if(isOdd) list.push(null); // bye
    const n = list.length;
    const rounds = n - 1;
    const half = n / 2;

    let homeFirst = true;
    const fixtures = [];
    let arr = list.slice();

    for(let r=1; r<=rounds; r++){
      const pairs = [];
      for(let i=0;i<half;i++){
        const a = arr[i];
        const b = arr[n-1-i];
        if(a==null || b==null) continue;
        const home = homeFirst ? a : b;
        const away = homeFirst ? b : a;
        pairs.push({ round:r, homeId:home, awayId:away });
      }
      fixtures.push(pairs);
      // rotate (keep first fixed)
      const fixed = arr[0];
      const rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr = [fixed, ...rest];
      homeFirst = !homeFirst;
    }

    const flat = fixtures.flat().map(p=>({
      id: nowId(),
      round: p.round,
      homeId: p.homeId,
      awayId: p.awayId,
      homeGoals: null,
      awayGoals: null,
      playedAt: null
    }));

    if(opts.doubleRound){
      const second = fixtures.flat().map(p=>({
        id: nowId(),
        round: p.round + rounds,
        homeId: opts.homeAway ? p.awayId : p.homeId,
        awayId: opts.homeAway ? p.homeId : p.awayId,
        homeGoals: null,
        awayGoals: null,
        playedAt: null
      }));
      return flat.concat(second);
    }
    return flat;
  }

  // --- UI Rendering
  const leagueNameEl = byId('leagueName');
  const seasonNameEl = byId('seasonName');
  const leagueLogoEl = byId('leagueLogo');
  const leagueLogoFallback = byId('leagueLogoFallback');

  const divSwitchEl = byId('divSwitch');
  const standingsBody = byId('standingsBody');
  const scheduleList = byId('scheduleList');
  const resultsList = byId('resultsList');
  const clubGrid = byId('clubGrid');

  const viewStandings = byId('viewStandings');
  const viewSchedule = byId('viewSchedule');
  const viewResults = byId('viewResults');
  const viewClubs = byId('viewClubs');

  const roundLabel = byId('roundLabel');

  function setTab(tab){
    db.selected.tab = tab;
    saveDB();
    for(const b of document.querySelectorAll('.segBtn')){
      b.classList.toggle('active', b.dataset.tab===tab);
    }
    viewStandings.classList.toggle('hidden', tab!=='standings');
    viewSchedule.classList.toggle('hidden', tab!=='schedule');
    viewResults.classList.toggle('hidden', tab!=='results');
    viewClubs.classList.toggle('hidden', tab!=='clubs');
    render();
  }

  function renderTop(){
    const league = getLeague();
    const season = getSeason();
    leagueNameEl.textContent = league.name || 'League';
    seasonNameEl.textContent = season.name || 'Season';
    setLogo(leagueLogoEl, leagueLogoFallback, league.logoDataUrl || '');
  }

  function renderDivSwitch(){
    const season = getSeason();
    const divId = db.selected.divisionId;
    divSwitchEl.innerHTML = '';
    for(const div of season.divisions){
      const btn = document.createElement('button');
      btn.className = 'divBtn' + (div.id===divId ? ' active':'');
      btn.textContent = div.name;
      btn.onclick = () => {
        db.selected.divisionId = div.id;
        db.selected.round = 1;
        saveDB();
        render();
      };
      divSwitchEl.appendChild(btn);
    }
  }

  function renderStandings(){
    const div = getDivision();
    const table = computeTable(div);

    // Save rank map for arrow comparisons next time (after render)
    const nextRankMap = {};
    table.forEach(r=> nextRankMap[r.id] = r.rank);

    standingsBody.innerHTML = '';
    for(const row of table){
      const tr = document.createElement('tr');

      // rank cell
      const tdRank = document.createElement('td');
      tdRank.className = 'colRank';
      const wrap = document.createElement('div');
      wrap.className = 'rankCell';

      const band = document.createElement('div');
      band.className = 'rankBand';
      const c = rankBandColor(div, row.rank);
      band.style.background = c || 'transparent';

      const arrow = arrowForRank(div, row.id, row.rank);
      const arrowEl = document.createElement('div');
      arrowEl.className = 'rankArrow ' + arrow.cls;
      arrowEl.textContent = arrow.text;

      const rankText = document.createElement('div');
      rankText.className = 'rankText';
      rankText.textContent = String(row.rank);

      wrap.appendChild(band);
      wrap.appendChild(rankText);
      wrap.appendChild(arrowEl);
      tdRank.appendChild(wrap);
      tr.appendChild(tdRank);

      // team
      const tdTeam = document.createElement('td');
      tdTeam.className = 'colTeam';

      const chip = document.createElement('div');
      chip.className = 'teamChip';
      chip.dataset.teamId = row.id;

      const badge = document.createElement('div');
      badge.className = 'badge';
      const img = document.createElement('img');
      const fb = document.createElement('div');
      fb.className = 'fallback';
      fb.textContent = '🏳️';
      badge.appendChild(img);
      badge.appendChild(fb);
      if(row.team.logoDataUrl){
        img.src = row.team.logoDataUrl;
        img.style.display = 'block';
        fb.style.display = 'none';
      }

      const name = document.createElement('div');
      name.className = 'teamName';
      name.textContent = row.name;

      chip.appendChild(badge);
      chip.appendChild(name);

      chip.onclick = () => openClubModal(row.id);
      tdTeam.appendChild(chip);
      tr.appendChild(tdTeam);

      const nums = [
        row.played, row.w, row.d, row.l, row.gf, row.ga, row.gd, row.pts
      ];
      for(const val of nums){
        const td = document.createElement('td');
        td.className = 'colNum num';
        td.textContent = String(val);
        tr.appendChild(td);
      }

      const tdForm = document.createElement('td');
      tdForm.className = 'colForm';
      const fd = document.createElement('div');
      fd.className = 'formDots';
      // Need 5 dots, from oldest->newest left to right (like UI). Our row.form is newest first.
      const last5 = row.form.slice().reverse(); // oldest->newest
      const padded = Array.from({length:5}).map((_,i)=> last5[i] || '');
      for(const f of padded){
        const dot = document.createElement('div');
        dot.className = 'dot' + (f ? ' '+f : '');
        fd.appendChild(dot);
      }
      tdForm.appendChild(fd);
      tr.appendChild(tdForm);

      standingsBody.appendChild(tr);
    }

    // Update lastRankMap AFTER drawing
    div.lastRankMap = nextRankMap;
    saveDB();
  }

  function maxRound(div){
    return Math.max(1, ...div.matches.map(m=>m.round || 1));
  }

  function renderSchedule(){
    const div = getDivision();
    const r = clamp(db.selected.round || 1, 1, maxRound(div));
    db.selected.round = r;
    saveDB();

    roundLabel.textContent = `${div.name} 第${r}節`;
    scheduleList.innerHTML = '';

    const mapTeams = new Map(div.teams.map(t=>[t.id,t]));
    const matches = div.matches.filter(m=>m.round===r);

    if(matches.length===0){
      scheduleList.innerHTML = `<div class="smallHint" style="padding:6px 2px;">日程がありません。「日程生成」を押してください。</div>`;
      return;
    }

    for(const m of matches){
      scheduleList.appendChild(matchRowEl(m, mapTeams, {editable:true}));
    }
  }

  function renderResults(){
    const div = getDivision();
    resultsList.innerHTML = '';
    const mapTeams = new Map(div.teams.map(t=>[t.id,t]));
    const played = div.matches.filter(m=>m.homeGoals!=null && m.awayGoals!=null)
      .sort((a,b)=> (b.playedAt||0)-(a.playedAt||0) || b.round-a.round);
    const latest = played.slice(0, 8);
    if(latest.length===0){
      resultsList.innerHTML = `<div class="smallHint" style="padding:6px 2px;">結果がまだありません。日程からスコアを入力してください。</div>`;
      return;
    }
    for(const m of latest){
      resultsList.appendChild(matchRowEl(m, mapTeams, {editable:true, showRound:true}));
    }
  }

  function renderClubs(){
    const div = getDivision();
    clubGrid.innerHTML = '';
    for(const t of div.teams){
      const card = document.createElement('div');
      card.className = 'clubCard';
      card.onclick = () => openClubModal(t.id);

      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.style.width='44px';
      badge.style.height='44px';
      badge.style.borderRadius='16px';
      const img = document.createElement('img');
      const fb = document.createElement('div');
      fb.className='fallback'; fb.textContent='🏳️';
      badge.appendChild(img); badge.appendChild(fb);
      if(t.logoDataUrl){
        img.src=t.logoDataUrl; img.style.display='block'; fb.style.display='none';
      }

      const meta = document.createElement('div');
      meta.className='meta';
      const title = document.createElement('div');
      title.className='title'; title.textContent = t.name;
      const sub = document.createElement('div');
      sub.className='sub'; sub.textContent = `${div.name} / タップで詳細`;
      meta.appendChild(title); meta.appendChild(sub);

      card.appendChild(badge);
      card.appendChild(meta);
      clubGrid.appendChild(card);
    }
  }

  function matchRowEl(m, mapTeams, opts){
    const row = document.createElement('div');
    row.className = 'matchRow';

    const home = mapTeams.get(m.homeId);
    const away = mapTeams.get(m.awayId);

    const homeEl = document.createElement('div');
    homeEl.className='matchTeam';
    homeEl.appendChild(teamMiniBadge(home));
    homeEl.appendChild(spanName(home?.name || '—'));

    const awayEl = document.createElement('div');
    awayEl.className='matchTeam';
    awayEl.style.justifyContent='flex-end';
    awayEl.appendChild(spanName(away?.name || '—'));
    awayEl.appendChild(teamMiniBadge(away));

    const score = document.createElement('div');
    score.className='scoreBox';
    score.textContent = (m.homeGoals==null || m.awayGoals==null) ? '—' : `${m.homeGoals} - ${m.awayGoals}`;
    if(opts.editable){
      score.title='タップでスコア入力';
      score.onclick = () => openScoreModal(m.id);
    }

    const kick = document.createElement('div');
    kick.className='kick';
    kick.textContent = opts.showRound ? `${getDivision().name} 第${m.round}節` : '';

    row.appendChild(homeEl);
    row.appendChild(score);
    row.appendChild(awayEl);
    row.appendChild(kick);

    return row;
  }

  function teamMiniBadge(team){
    const b = document.createElement('div');
    b.className='badge';
    const img = document.createElement('img');
    const fb = document.createElement('div');
    fb.className='fallback'; fb.textContent='🏳️';
    b.appendChild(img); b.appendChild(fb);
    if(team?.logoDataUrl){
      img.src=team.logoDataUrl; img.style.display='block'; fb.style.display='none';
    }
    return b;
  }
  function spanName(name){
    const s = document.createElement('div');
    s.className='name'; s.textContent=name;
    return s;
  }

  // --- Modal system
  const overlay = byId('modalOverlay');
  const modalTitle = byId('modalTitle');
  const modalBody = byId('modalBody');
  const modalFooter = byId('modalFooter');
  const modalClose = byId('modalClose');

  function openModal(title, bodyNode, footerNode){
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    modalFooter.innerHTML = '';
    modalBody.appendChild(bodyNode);
    if(footerNode) modalFooter.appendChild(footerNode);
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden','false');
  }
  function closeModal(){
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden','true');
  }
  overlay.addEventListener('click', (e)=>{
    if(e.target===overlay) closeModal();
  });
  modalClose.addEventListener('click', closeModal);

  // --- Manage modal
  function openManageModal(){
    const league = getLeague();
    const season = getSeason();

    const root = document.createElement('div');

    // League edit
    root.appendChild(sectionTitle('リーグ'));
    root.appendChild(fieldText('リーグ名', league.name, (v)=> { league.name=v; }));
    root.appendChild(fieldFile('リーグロゴ', async (file)=>{
      league.logoDataUrl = await readFileAsDataURL(file);
    }, league.logoDataUrl));

    const leagueButtons = document.createElement('div');
    leagueButtons.className='btnRow';
    leagueButtons.appendChild(btn('＋リーグ追加', ()=> addLeague()));
    leagueButtons.appendChild(btn('リーグ削除', ()=> confirmDelete('このリーグを削除しますか？', ()=>{
      deleteLeague(league.id);
      closeModal(); render();
    }), 'danger'));
    root.appendChild(leagueButtons);

    root.appendChild(hr());

    // Season
    root.appendChild(sectionTitle('シーズン'));
    const seasonRow = document.createElement('div');
    seasonRow.className='btnRow';
    seasonRow.appendChild(btn('＋新シーズン', ()=> { createNextSeason(); toast('新シーズンを作成しました'); closeModal(); render(); }));
    seasonRow.appendChild(btn('シーズン削除', ()=> confirmDelete('このシーズンを削除しますか？', ()=>{
      deleteSeason(season.id); closeModal(); render();
    }), 'danger'));
    root.appendChild(seasonRow);

    root.appendChild(hr());

    // Divisions list
    root.appendChild(sectionTitle('ディビジョン'));
    for(const div of season.divisions){
      const row = document.createElement('div');
      row.className='btnRow';
      row.style.alignItems='center';

      const tag = document.createElement('div');
      tag.className='pill';
      tag.style.cursor='default';
      tag.textContent = `${div.name}（${div.teams.length}チーム）`;
      row.appendChild(tag);

      row.appendChild(btn('編集', ()=> openDivisionEditModal(div.id)));
      row.appendChild(btn('削除', ()=> confirmDelete('このディビジョンを削除しますか？', ()=>{
        deleteDivision(div.id); closeModal(); render();
      }), 'danger'));
      root.appendChild(row);
    }
    root.appendChild(btn('＋ディビジョン追加', ()=> { addDivision(); toast('ディビジョンを追加しました'); closeModal(); render(); }));

    const footer = footerButtons([
      {text:'閉じる', onClick: closeModal},
      {text:'保存', onClick: ()=> { saveDB(); toast('保存しました'); closeModal(); render(); } }
    ]);

    openModal('管理', root, footer);
  }

  function openDivisionEditModal(divisionId){
    const season = getSeason();
    const div = season.divisions.find(d=>d.id===divisionId);
    if(!div) return;

    const root = document.createElement('div');

    root.appendChild(fieldText('ディビジョン名', div.name, (v)=> div.name=v));
    root.appendChild(fieldFile('ディビジョンエンブレム', async (file)=>{
      div.logoDataUrl = await readFileAsDataURL(file);
    }, div.logoDataUrl));

    root.appendChild(hr());
    root.appendChild(sectionTitle('チーム'));

    // team list
    for(const team of div.teams){
      const row = document.createElement('div');
      row.className='btnRow';
      row.style.alignItems='center';

      const chip = document.createElement('div');
      chip.className='pill';
      chip.style.cursor='default';
      chip.style.flex='1';
      chip.textContent = team.name;
      row.appendChild(chip);

      row.appendChild(btn('編集', ()=> openClubModal(team.id, {fromManage:true})));
      row.appendChild(btn('削除', ()=> confirmDelete(`${team.name} を削除しますか？`, ()=>{
        deleteTeam(div.id, team.id);
        closeModal(); // close div modal
        openDivisionEditModal(div.id);
        render();
      }), 'danger'));
      root.appendChild(row);
    }

    root.appendChild(btn('＋チーム追加', ()=>{
      addTeam(div.id);
      closeModal();
      openDivisionEditModal(div.id);
      render();
    }));

    const footer = footerButtons([
      {text:'戻る', onClick: ()=> { closeModal(); openManageModal(); }},
      {text:'保存', onClick: ()=> { saveDB(); toast('保存しました'); closeModal(); render(); }}
    ]);

    openModal('ディビジョン編集', root, footer);
  }

  // --- Rank colors
  function openRankColorsModal(){
    const div = getDivision();
    const root = document.createElement('div');
    root.appendChild(sectionTitle('順位カラー'));
    root.appendChild(divLogoRow(div));

    const listWrap = document.createElement('div');

    function renderList(){
      listWrap.innerHTML='';
      (div.rankColors||[]).forEach((rc, idx)=>{
        const row = document.createElement('div');
        row.className='row2';

        const left = document.createElement('div');
        left.appendChild(fieldNumber('開始順位', rc.from, (v)=> rc.from=v, 1, 999));
        left.appendChild(fieldNumber('終了順位', rc.to, (v)=> rc.to=v, 1, 999));

        const right = document.createElement('div');
        right.appendChild(fieldText('名称', rc.label||'', (v)=> rc.label=v));
        right.appendChild(fieldColor('カラー', rc.color||'#ffffff', (v)=> rc.color=v));

        row.appendChild(left);
        row.appendChild(right);

        const row2 = document.createElement('div');
        row2.className='btnRow';
        row2.appendChild(btn('削除', ()=> {
          div.rankColors.splice(idx,1);
          renderList();
        }, 'danger'));

        listWrap.appendChild(row);
        listWrap.appendChild(row2);
        listWrap.appendChild(hr());
      });
    }

    renderList();
    root.appendChild(listWrap);

    root.appendChild(btn('＋追加', ()=>{
      div.rankColors = div.rankColors || [];
      div.rankColors.push({from:1,to:1,color:'#FFD94A',label:''});
      renderList();
    }));

    const footer = footerButtons([
      {text:'閉じる', onClick: closeModal},
      {text:'保存', onClick: ()=>{ saveDB(); toast('保存しました'); closeModal(); render(); }}
    ]);
    openModal('順位カラー編集', root, footer);
  }

  // --- Score entry
  function openScoreModal(matchId){
    const div = getDivision();
    const match = div.matches.find(m=>m.id===matchId);
    if(!match) return;

    const home = div.teams.find(t=>t.id===match.homeId);
    const away = div.teams.find(t=>t.id===match.awayId);

    const root = document.createElement('div');
    root.appendChild(sectionTitle('スコア入力'));
    const row = document.createElement('div');
    row.className='row2';
    row.appendChild(fieldNumber(`${home?.name||'Home'} 得点`, match.homeGoals ?? '', (v)=> match.homeGoals = (v===''?null:v), 0, 99, true));
    row.appendChild(fieldNumber(`${away?.name||'Away'} 得点`, match.awayGoals ?? '', (v)=> match.awayGoals = (v===''?null:v), 0, 99, true));
    root.appendChild(row);

    const rowB = document.createElement('div');
    rowB.className='btnRow';
    rowB.appendChild(btn('未入力に戻す', ()=> {
      match.homeGoals = null; match.awayGoals = null; match.playedAt=null;
      saveDB(); toast('未入力に戻しました'); closeModal(); render();
    }));
    root.appendChild(rowB);

    const footer = footerButtons([
      {text:'閉じる', onClick: closeModal},
      {text:'保存', onClick: ()=>{
        if(match.homeGoals!=null && match.awayGoals!=null){
          match.playedAt = Date.now();
        }
        saveDB();
        toast('保存しました');
        closeModal();
        render();
      }}
    ]);
    openModal('結果入力', root, footer);
  }

  // --- Club detail modal
  function openClubModal(teamId, opts={}){
    const season = getSeason();
    const div = getDivision();
    const team = div.teams.find(t=>t.id===teamId);
    if(!team) return;

    const root = document.createElement('div');

    // Header layout
    const top = document.createElement('div');
    top.className='btnRow';
    top.style.alignItems='center';

    const badge = document.createElement('div');
    badge.className='badge';
    badge.style.width='82px'; badge.style.height='82px'; badge.style.borderRadius='26px';
    badge.style.cursor = 'pointer';
    badge.title = 'タップしてロゴ画像を設定';
    const img = document.createElement('img');
    const fb = document.createElement('div'); fb.className='fallback'; fb.textContent='🏳️';
    badge.appendChild(img); badge.appendChild(fb);
    if(team.logoDataUrl){ img.src=team.logoDataUrl; img.style.display='block'; fb.style.display='none'; }

    // Hidden file input for logo
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = async ()=>{
      const file = fileInput.files && fileInput.files[0];
      if(!file) return;
      team.logoDataUrl = await readFileAsDataURL(file);
      // reflect immediately
      img.src = team.logoDataUrl;
      img.style.display='block';
      fb.style.display='none';
      toast('ロゴを設定しました');
    };
    badge.addEventListener('click', ()=> fileInput.click());

    const meta = document.createElement('div');
    meta.style.flex='1';
    meta.style.minWidth='0';
    const title = document.createElement('div');
    title.style.fontSize='20px'; title.style.fontWeight='750';
    title.textContent = team.name;
    const sub = document.createElement('div');
    sub.className='smallHint';
    sub.textContent = `現在のリーグ：${getLeague().name} / ${div.name}`;
    meta.appendChild(title); meta.appendChild(sub);

    top.appendChild(badge);
    top.appendChild(fileInput);
    top.appendChild(meta);
    root.appendChild(top);

    root.appendChild(hr());

    // Editable team name
    root.appendChild(sectionTitle('クラブ名'));
    root.appendChild(fieldText('チーム名', team.name, (v)=>{ team.name = v; title.textContent = v; }));

    root.appendChild(hr());

    root.appendChild(sectionTitle('クラブ情報（コメント）'));
    const ta = document.createElement('textarea');
    ta.value = team.comment || '';
    ta.placeholder = 'クラブ紹介 / メモ';
    ta.oninput = () => team.comment = ta.value;
    root.appendChild(ta);

    root.appendChild(hr());

    // Season-by-season performance (snapshots + current)
    root.appendChild(sectionTitle('シーズン別戦績'));
    const perfTable = document.createElement('table');
    perfTable.innerHTML = `
      <thead>
        <tr>
          <th>Season</th><th>Div</th><th>順位</th><th>勝点</th><th>試合</th><th>勝</th><th>分</th><th>負</th><th>得失点</th><th>勝率</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = perfTable.querySelector('tbody');

    const rows = [];
    // from history snapshots
    for(const d of season.divisions){
      const snaps = (season.history && season.history[d.id]) || [];
      for(const s of snaps){
        const rec = s.rows.find(r=>r.teamId===teamId);
        if(rec){
          rows.push({
            seasonId: s.seasonId,
            seasonName: s.seasonName,
            divName: d.name,
            rank: rec.rank,
            pts: rec.pts,
            played: rec.played,
            w: rec.w, d: rec.d, l: rec.l,
            gf: rec.gf, ga: rec.ga,
            winp: rec.played ? (rec.w/rec.played*100) : 0
          });
        }
      }
    }
    // current season table (live)
    const live = computeTable(div);
    const liveRow = live.find(r=>r.id===teamId);
    if(liveRow){
      rows.push({
        seasonId: season.id,
        seasonName: season.name,
        divName: div.name,
        rank: liveRow.rank,
        pts: liveRow.pts,
        played: liveRow.played,
        w: liveRow.w, d: liveRow.d, l: liveRow.l,
        gf: liveRow.gf, ga: liveRow.ga,
        winp: liveRow.played ? (liveRow.w/liveRow.played*100) : 0
      });
    }

    if(rows.length===0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="10" style="color:rgba(255,255,255,.6);padding:12px;">まだ戦績がありません</td>`;
      tr.onclick = () => {
  const league = getLeague();
  const currentSeason = getSeason();

  // Current season: use live matches
  if(r.seasonId === currentSeason.id){
    openSeasonMatchesModal(teamId, { seasonName: currentSeason.name, divName: div.name, matches: div.matches, teams: div.teams });
    return;
  }

  // Past seasons: find snapshot with matches
  const ss = league.seasons.find(x=>x.id===r.seasonId);
  if(ss){
    for(const d of ss.divisions){
      const snaps = (ss.history && ss.history[d.id]) || [];
      const snap = snaps.find(sp=>sp.seasonId===r.seasonId);
      if(snap && Array.isArray(snap.matches)){
        openSeasonMatchesModal(teamId, { seasonName: snap.seasonName, divName: d.name, matches: snap.matches, teams: d.teams });
        return;
      }
    }
  }
  toast('このシーズンの試合データが見つかりません（シーズン終了で保存されます）');
};
tbody.appendChild(tr);

    }else{
      // sort by season name fallback created order (we keep as-is)
      for(const r of rows){
        const tr = document.createElement('tr');
        tr.style.cursor='pointer';
        tr.title='タップでそのシーズンの全節スコア';
        tr.innerHTML = `
          <td>${escapeHtml(r.seasonName)}</td>
          <td>${escapeHtml(r.divName)}</td>
          <td class="num">${r.rank}</td>
          <td class="num">${r.pts}</td>
          <td class="num">${r.played}</td>
          <td class="num">${r.w}</td>
          <td class="num">${r.d}</td>
          <td class="num">${r.l}</td>
          <td class="num">${r.gf}-${r.ga}</td>
          <td class="num">${r.winp.toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
      }
    }
    perfTable.style.width='100%';
    perfTable.style.borderSpacing='0';
    perfTable.style.borderCollapse='separate';
    root.appendChild(perfTable);

    root.appendChild(hr());

    // Upcoming + recent results for this club (current division)
    root.appendChild(sectionTitle('対戦カード（第1節〜最終節）'));
const mapTeams = new Map(div.teams.map(t=>[t.id,t]));
const all = div.matches.slice().filter(m=> (m.homeId===teamId||m.awayId===teamId)).sort((a,b)=>a.round-b.round);

const box = document.createElement('div');
box.className='list';
box.style.padding='0';

if(all.length===0){
  box.innerHTML = `<div class="smallHint" style="padding:6px 2px;">日程がありません。「日程生成」から作成してください。</div>`;
}else{
  all.forEach(m=> box.appendChild(matchRowEl(m, mapTeams, {editable:true, showRound:true})));
}
root.appendChild(box);

    const footer = footerButtons([
      {text:'閉じる', onClick: closeModal},
      {text:'保存', onClick: ()=>{ saveDB(); toast('保存しました'); closeModal(); render(); }}
    ]);

    openModal('クラブ', root, footer);
  }

  // --- History modal (season snapshots per division)
  function openHistoryModal(){
    const season = getSeason();
    const root = document.createElement('div');
    root.appendChild(sectionTitle('歴代シーズン戦績（各ディビジョン）'));

    for(const div of season.divisions){
      const title = document.createElement('div');
      title.style.display='flex';
      title.style.alignItems='center';
      title.style.justifyContent='space-between';
      title.style.gap='10px';

      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:750;">${escapeHtml(div.name)}</div><div class="smallHint">終了したシーズンの順位表スナップショット</div>`;
      title.appendChild(left);

      root.appendChild(title);

      const snaps = (season.history && season.history[div.id]) || [];
      if(snaps.length===0){
        const p = document.createElement('div');
        p.className='smallHint';
        p.style.padding='8px 0 14px';
        p.textContent='まだ履歴がありません。「シーズン終了」を押すと保存されます。';
        root.appendChild(p);
        root.appendChild(hr());
        continue;
      }

      for(const s of snaps.slice().reverse()){
        const box = document.createElement('div');
        box.className='card';
        box.style.margin='10px 0';
        box.style.background='rgba(0,0,0,.12)';
        box.style.boxShadow='none';

        const head = document.createElement('div');
        head.className='cardHeader';
        head.style.borderBottom='1px solid rgba(255,255,255,.08)';
        const h2 = document.createElement('div');
        h2.style.fontWeight='750';
        h2.textContent = `${s.seasonName}`;
        const small = document.createElement('div');
        small.className='smallHint';
        small.textContent = new Date(s.savedAt).toLocaleString();
        head.appendChild(h2); head.appendChild(small);
        box.appendChild(head);

        const wrap = document.createElement('div');
        wrap.className='tableWrap';
        const t = document.createElement('table');
        t.innerHTML = `
          <thead><tr>
            <th>順位</th><th>チーム</th><th class="colNum">試合</th><th class="colNum">勝</th><th class="colNum">分</th><th class="colNum">負</th><th class="colNum">得点</th><th class="colNum">失点</th><th class="colNum">差</th><th class="colNum">勝点</th>
          </tr></thead>
          <tbody></tbody>
        `;
        const tb = t.querySelector('tbody');
        const teamMap = new Map(div.teams.map(tt=>[tt.id,tt]));
        for(const r of s.rows){
          const tr = document.createElement('tr');
          const team = teamMap.get(r.teamId);
          tr.innerHTML = `
            <td>${r.rank}</td>
            <td>${escapeHtml(team?.name || r.teamName || '—')}</td>
            <td class="num">${r.played}</td>
            <td class="num">${r.w}</td>
            <td class="num">${r.d}</td>
            <td class="num">${r.l}</td>
            <td class="num">${r.gf}</td>
            <td class="num">${r.ga}</td>
            <td class="num">${r.gd}</td>
            <td class="num">${r.pts}</td>
          `;
          tb.appendChild(tr);
        }
        wrap.appendChild(t);
        box.appendChild(wrap);

        root.appendChild(box);
      }
      root.appendChild(hr());
    }

    const footer = footerButtons([
      {text:'閉じる', onClick: closeModal}
    ]);
    openModal('戦績（歴代）', root, footer);
  }

  // --- Season operations
  function createNextSeason(){
    const league = getLeague();
    const current = getSeason();
    // number suffix
    const m = (current.name||'').match(/(\d+)/);
    const nextN = m ? (parseInt(m[1],10)+1) : (league.seasons.length+1);
    const newSeason = {
      id: nowId(),
      name: `Season ${nextN}`,
      createdAt: Date.now(),
      endedAt: null,
      divisions: JSON.parse(JSON.stringify(current.divisions)).map(d=>{
        // reset matches and lastRankMap, keep teams and logos
        d.id = nowId();
        d.matches = [];
        d.lastRankMap = {};
        // team ids must persist across seasons for history? user wants same club history.
        // We'll keep team ids same to track club across seasons, but divisions are new.
        return d;
      }),
      history: current.history || {}
    };
    league.seasons.push(newSeason);
    db.selected.seasonId = newSeason.id;
    db.selected.divisionId = newSeason.divisions[0]?.id || newSeason.id;
    db.selected.round = 1;
    saveDB();
  }

  function endSeason(){ endSeasonWithMatches(); }

  // --- CRUD
  function addLeague(){
    const id = nowId();
    const seasonId = nowId();
    const divId = nowId();
    const teams = Array.from({length: 8}).map((_,i)=>({id:nowId(),name:`Team${i+1}`,logoDataUrl:'',comment:''}));
    db.leagues.push({
      id,
      name: `League ${db.leagues.length+1}`,
      logoDataUrl:'',
      seasons: [{
        id: seasonId,
        name: 'Season 1',
        createdAt: Date.now(),
        endedAt:null,
        divisions: [{
          id: divId,
          name: 'Div.1',
          logoDataUrl:'',
          teams,
          matches: [],
          rankColors: [],
          lastRankMap: {}
        }],
        history: {}
      }]
    });
    db.selected.leagueId = id;
    db.selected.seasonId = seasonId;
    db.selected.divisionId = divId;
    db.selected.round = 1;
    saveDB();
    toast('リーグを追加しました');
    render();
  }

  function deleteLeague(leagueId){
    if(db.leagues.length<=1){ toast('最後のリーグは削除できません'); return; }
    db.leagues = db.leagues.filter(l=>l.id!==leagueId);
    const l = db.leagues[0];
    db.selected.leagueId = l.id;
    db.selected.seasonId = l.seasons[0].id;
    db.selected.divisionId = l.seasons[0].divisions[0].id;
    db.selected.round = 1;
    saveDB();
    toast('リーグを削除しました');
  }

  function deleteSeason(seasonId){
    const league = getLeague();
    if(league.seasons.length<=1){ toast('最後のシーズンは削除できません'); return; }
    league.seasons = league.seasons.filter(s=>s.id!==seasonId);
    const s = league.seasons[league.seasons.length-1];
    db.selected.seasonId = s.id;
    db.selected.divisionId = s.divisions[0].id;
    db.selected.round = 1;
    saveDB();
    toast('シーズンを削除しました');
  }

  function addDivision(){
    const season = getSeason();
    const divN = season.divisions.length+1;
    const div = {
      id: nowId(),
      name: `Div.${divN}`,
      logoDataUrl:'',
      teams: [],
      matches: [],
      rankColors: [],
      lastRankMap: {}
    };
    season.divisions.push(div);
    db.selected.divisionId = div.id;
    saveDB();
  }

  function deleteDivision(divId){
    const season = getSeason();
    if(season.divisions.length<=1){ toast('最後のディビジョンは削除できません'); return; }
    season.divisions = season.divisions.filter(d=>d.id!==divId);
    db.selected.divisionId = season.divisions[0].id;
    db.selected.round = 1;
    saveDB();
    toast('ディビジョンを削除しました');
  }

  function addTeam(divId){
    const season = getSeason();
    const div = season.divisions.find(d=>d.id===divId);
    if(!div) return;
    const idx = div.teams.length+1;
    div.teams.push({ id: nowId(), name: `Team${idx}`, logoDataUrl:'', comment:'' });
    // schedule becomes invalid; keep but warn
    saveDB();
    toast('チームを追加しました（必要なら日程を再生成）');
  }

  function deleteTeam(divId, teamId){
    const season = getSeason();
    const div = season.divisions.find(d=>d.id===divId);
    if(!div) return;
    if(div.teams.length<=2){ toast('2チーム未満にはできません'); return; }
    div.teams = div.teams.filter(t=>t.id!==teamId);
    // remove matches containing team
    div.matches = div.matches.filter(m=>m.homeId!==teamId && m.awayId!==teamId);
    saveDB();
    toast('チームを削除しました');
  }

  // --- UI components
  function sectionTitle(text){
    const h = document.createElement('div');
    h.style.fontWeight='750';
    h.style.margin='2px 0 10px';
    h.textContent = text;
    return h;
  }
  function hr(){
    const r = document.createElement('hr');
    r.className='sep';
    return r;
  }
  function btn(text, onClick, extraClass=''){
    const b = document.createElement('button');
    b.className = 'pill' + (extraClass?(' '+extraClass):'');
    b.textContent = text;
    b.type='button';
    b.onclick = (e)=>{ e.preventDefault(); onClick(); };
    return b;
  }
  function footerButtons(btns){
    const wrap = document.createElement('div');
    wrap.style.display='flex';
    wrap.style.gap='10px';
    wrap.style.justifyContent='flex-end';
    btns.forEach(b=> wrap.appendChild(btn(b.text, b.onClick, b.danger?'danger':'')));
    return wrap;
  }

  function fieldText(labelText, value, onChange){
    const f = document.createElement('div');
    f.className='field';
    const l = document.createElement('label');
    l.textContent = labelText;
    const input = document.createElement('input');
    input.type='text';
    input.value = value ?? '';
    input.oninput = ()=> onChange(input.value);
    f.appendChild(l); f.appendChild(input);
    return f;
  }

  function fieldNumber(labelText, value, onChange, min, max, allowEmpty=false){
    const f = document.createElement('div');
    f.className='field';
    const l = document.createElement('label');
    l.textContent = labelText;
    const input = document.createElement('input');
    input.type='number';
    input.inputMode='numeric';
    input.value = (value===null || value===undefined) ? '' : String(value);
    if(min!=null) input.min=String(min);
    if(max!=null) input.max=String(max);
    input.oninput = ()=>{
      if(allowEmpty && input.value===''){ onChange(''); return; }
      const n = Number(input.value);
      if(Number.isNaN(n)) return;
      onChange(clamp(n, min??-1e9, max??1e9));
    };
    f.appendChild(l); f.appendChild(input);
    return f;
  }

  function fieldColor(labelText, value, onChange){
    const f = document.createElement('div');
    f.className='field';
    const l = document.createElement('label');
    l.textContent = labelText;
    const wrap = document.createElement('div');
    wrap.className = 'colorPickerWrap';

    const input = document.createElement('input');
    input.type='color';
    // Ensure valid hex for <input type="color">
    const safe = (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) ? value : '#ffffff';
    input.value = safe;
    input.oninput = ()=> onChange(input.value);

    const hex = document.createElement('div');
    hex.className='smallHint';
    hex.textContent = safe.toUpperCase();
    input.addEventListener('input', ()=> { hex.textContent = input.value.toUpperCase(); });

    wrap.appendChild(input);
    wrap.appendChild(hex);

    f.appendChild(l); f.appendChild(wrap);
    return f;
  }

  function fieldFile(labelText, onFile, currentDataUrl){
    const f = document.createElement('div');
    f.className='field';
    const l = document.createElement('label');
    l.textContent = labelText;
    const input = document.createElement('input');
    input.type='file';
    input.accept='image/*';
    input.onchange = async ()=>{
      const file = input.files && input.files[0];
      if(!file) return;
      await onFile(file);
      toast('画像を設定しました');
    };
    const hint = document.createElement('div');
    hint.className='smallHint';
    hint.textContent = currentDataUrl ? '設定済み（変更可）' : '未設定';
    f.appendChild(l); f.appendChild(input); f.appendChild(hint);
    return f;
  }

  function divLogoRow(div){
    const row = document.createElement('div');
    row.className='btnRow';
    row.style.alignItems='center';
    const b = document.createElement('div');
    b.className='badge';
    b.style.width='44px'; b.style.height='44px'; b.style.borderRadius='16px';
    const img = document.createElement('img');
    const fb = document.createElement('div'); fb.className='fallback'; fb.textContent='🏴';
    b.appendChild(img); b.appendChild(fb);
    if(div.logoDataUrl){ img.src=div.logoDataUrl; img.style.display='block'; fb.style.display='none'; }
    const t = document.createElement('div');
    t.className='smallHint';
    t.textContent='ディビジョンエンブレムは管理→ディビジョン編集から設定できます';
    row.appendChild(b); row.appendChild(t);
    return row;
  }

  function confirmDelete(message, onYes){
    const root = document.createElement('div');
    const p = document.createElement('div');
    p.style.margin='4px 0 12px';
    p.textContent = message;
    root.appendChild(p);
    const footer = footerButtons([
      {text:'キャンセル', onClick: closeModal},
      {text:'削除', onClick: ()=>{ onYes(); saveDB(); toast('削除しました'); closeModal(); render(); }, danger:true}
    ]);
    openModal('確認', root, footer);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c)=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  
// --- Switcher modals (League / Season)
function openLeagueSeasonSwitcher(){
  const root = document.createElement('div');
  root.appendChild(sectionTitle('リーグ / シーズン切り替え'));

  const leaguesWrap = document.createElement('div');
  leaguesWrap.className = 'btnRow';
  leaguesWrap.style.flexDirection = 'column';
  leaguesWrap.style.alignItems = 'stretch';

  const curLeagueId = db.selected.leagueId;

  db.leagues.forEach((l)=>{
    const row = document.createElement('div');
    row.className='btnRow';
    row.style.alignItems='center';
    row.style.justifyContent='space-between';

    const left = document.createElement('div');
    left.style.display='flex';
    left.style.alignItems='center';
    left.style.gap='10px';

    const b = document.createElement('div');
    b.className='badge';
    const img=document.createElement('img');
    const fb=document.createElement('div'); fb.className='fallback'; fb.textContent='🏳️';
    b.appendChild(img); b.appendChild(fb);
    if(l.logoDataUrl){ img.src=l.logoDataUrl; img.style.display='block'; fb.style.display='none'; }

    const name = document.createElement('div');
    name.style.fontWeight='750';
    name.textContent = l.name || 'League';

    left.appendChild(b);
    left.appendChild(name);

    const pick = btn(l.id===curLeagueId ? '選択中' : '切替', ()=>{
      db.selected.leagueId = l.id;
      db.selected.seasonId = l.seasons[l.seasons.length-1]?.id || l.seasons[0]?.id;
      const s = l.seasons.find(x=>x.id===db.selected.seasonId) || l.seasons[0];
      db.selected.divisionId = s?.divisions[0]?.id || '';
      db.selected.round = 1;
      saveDB();
      closeModal();
      render();
    });

    row.appendChild(left);
    row.appendChild(pick);
    leaguesWrap.appendChild(row);

    if(l.id===db.selected.leagueId){
      const seasonsBox = document.createElement('div');
      seasonsBox.style.margin = '6px 0 10px 54px';
      seasonsBox.style.display='flex';
      seasonsBox.style.flexDirection='column';
      seasonsBox.style.gap='6px';

      l.seasons.slice().reverse().forEach((s)=>{
        const line = document.createElement('div');
        line.className='btnRow';
        line.style.justifyContent='space-between';
        line.style.alignItems='center';

        const t = document.createElement('div');
        t.className='smallHint';
        const ended = s.endedAt ? '（終了）' : '';
        t.textContent = `${s.name}${ended}`;

        const pickS = btn(s.id===db.selected.seasonId ? '選択中' : '開く', ()=>{
          db.selected.seasonId = s.id;
          db.selected.divisionId = s.divisions[0]?.id || '';
          db.selected.round = 1;
          saveDB();
          closeModal();
          render();
        });

        line.appendChild(t);
        line.appendChild(pickS);
        seasonsBox.appendChild(line);
      });

      leaguesWrap.appendChild(seasonsBox);
    }
  });

  root.appendChild(leaguesWrap);
  openModal('切り替え', root, footerButtons([{text:'閉じる', onClick: closeModal}]));
}

// --- Season end saves standings + full match list (so you can open old season results)
function endSeasonWithMatches(){
  const season = getSeason();
  season.history = season.history || {};
  for(const div of season.divisions){
    const table = computeTable(div);
    const rows = table.map(r=>({
      teamId: r.id,
      teamName: r.name,
      rank: r.rank,
      played: r.played,
      w: r.w, d: r.d, l: r.l,
      gf: r.gf, ga: r.ga, gd: r.gd,
      pts: r.pts
    }));
    const snap = {
      seasonId: season.id,
      seasonName: season.name,
      savedAt: Date.now(),
      rows,
      matches: div.matches.slice()
    };
    season.history[div.id] = season.history[div.id] || [];
    season.history[div.id].push(snap);
  }
  season.endedAt = Date.now();
  saveDB();
  toast('シーズン戦績を保存しました');
}

function openSeasonMatchesModal(teamId, payload){
  const root = document.createElement('div');
  root.appendChild(sectionTitle(`${payload.seasonName} / ${payload.divName}：全節スコア`));

  const mapTeams = new Map(payload.teams.map(t=>[t.id,t]));
  const all = (payload.matches||[]).filter(m=>m.homeId===teamId||m.awayId===teamId).sort((a,b)=>a.round-b.round);

  const box = document.createElement('div');
  box.className='list';
  box.style.padding='0';

  if(all.length===0){
    box.innerHTML = `<div class="smallHint" style="padding:6px 2px;">スコアがありません</div>`;
  }else{
    all.forEach(m=> box.appendChild(matchRowEl(m, mapTeams, {editable:false, showRound:true})));
  }
  root.appendChild(box);
  openModal('全節スコア', root, footerButtons([{text:'閉じる', onClick: closeModal}]));
}

// --- Buttons & events
  document.querySelectorAll('.segBtn').forEach(b=>{
    b.addEventListener('click', ()=> setTab(b.dataset.tab));
  });

  byId('btnManage').addEventListener('click', openManageModal);
  byId('btnRankColors').addEventListener('click', openRankColorsModal);
  byId('btnHistory').addEventListener('click', openHistoryModal);

  byId('btnPrevRound').addEventListener('click', ()=>{
    const div = getDivision();
    db.selected.round = clamp((db.selected.round||1)-1, 1, maxRound(div));
    saveDB();
    render();
  });
  byId('btnNextRound').addEventListener('click', ()=>{
    const div = getDivision();
    db.selected.round = clamp((db.selected.round||1)+1, 1, maxRound(div));
    saveDB();
    render();
  });

  byId('btnAllResults').addEventListener('click', ()=>{
    const div = getDivision();
    const root = document.createElement('div');
    root.appendChild(sectionTitle('全結果'));
    const mapTeams = new Map(div.teams.map(t=>[t.id,t]));
    const all = div.matches.filter(m=>m.homeGoals!=null&&m.awayGoals!=null)
      .sort((a,b)=> (b.playedAt||0)-(a.playedAt||0) || b.round-a.round);
    const box = document.createElement('div');
    box.className='list';
    box.style.padding='0';
    if(all.length===0){
      box.innerHTML = `<div class="smallHint" style="padding:6px 2px;">結果がありません</div>`;
    }else{
      all.forEach(m=> box.appendChild(matchRowEl(m, mapTeams, {editable:true, showRound:true})));
    }
    root.appendChild(box);
    openModal('全結果', root, footerButtons([{text:'閉じる', onClick: closeModal}]));
  });

  byId('btnGenSchedule').addEventListener('click', ()=>{
    const div = getDivision();
    if(div.teams.length < 2){ toast('チームが足りません'); return; }
    // simple confirm prompts
    const doubleRound = confirm('総当たりを2回戦（ホーム&アウェイ）にしますか？\nOK=2回 / キャンセル=1回');
    const homeAway = doubleRound ? confirm('2回戦目はホーム&アウェイを入れ替えますか？\nOK=入れ替え / キャンセル=同じ並び') : false;

    div.matches = generateRoundRobin(div.teams, {doubleRound, homeAway});
    db.selected.round = 1;
    saveDB();
    toast('日程を生成しました');
    setTab('schedule');
  });

  byId('btnNewSeason').addEventListener('click', ()=>{
    createNextSeason();
    toast('新シーズンに移行しました');
    render();
  });

  byId('btnEndSeason').addEventListener('click', ()=>{
    const season = getSeason();
    const root = document.createElement('div');
    root.appendChild(sectionTitle('シーズン終了'));
    const p = document.createElement('div');
    p.className='smallHint';
    p.textContent = '現在の順位表を「歴代戦績」に保存します（各ディビジョンごと）。';
    root.appendChild(p);
    openModal('確認', root, footerButtons([
      {text:'キャンセル', onClick: closeModal},
      {text:'保存する', onClick: ()=>{ endSeasonWithMatches(); closeModal(); render(); }}
    ]));
  });

  // Back button (simple)
  byId('btnBack').addEventListener('click', ()=>{
    // go to standings quickly
    setTab('standings');
  });

  
  // Tap league/season (top bar) to switch
  byId('leagueLogoWrap').addEventListener('click', openLeagueSeasonSwitcher);
  byId('leagueName').addEventListener('click', openLeagueSeasonSwitcher);
  byId('seasonName').addEventListener('click', openLeagueSeasonSwitcher);

// --- Render
  function render(){
    renderTop();
    renderDivSwitch();
    setTab(db.selected.tab || 'standings'); // will call render again, so guard:
  }

  // Guard against recursive render via setTab
  const _setTab = setTab;
  setTab = function(tab){
    db.selected.tab = tab;
    saveDB();
    for(const b of document.querySelectorAll('.segBtn')){
      b.classList.toggle('active', b.dataset.tab===tab);
    }
    viewStandings.classList.toggle('hidden', tab!=='standings');
    viewSchedule.classList.toggle('hidden', tab!=='schedule');
    viewResults.classList.toggle('hidden', tab!=='results');
    viewClubs.classList.toggle('hidden', tab!=='clubs');

    renderTop();
    renderDivSwitch();
    if(tab==='standings') renderStandings();
    if(tab==='schedule') renderSchedule();
    if(tab==='results') renderResults();
    if(tab==='clubs') renderClubs();
  };

  // Initial
  // ensure selected ids exist
  (function normalizeSelection(){
    const league = getLeague();
    db.selected.leagueId = league.id;
    const season = getSeason();
    db.selected.seasonId = season.id;
    db.selected.divisionId = getDivision().id;
    db.selected.round = db.selected.round || 1;
    db.selected.tab = db.selected.tab || 'standings';
    saveDB();
  })();

  setTab(db.selected.tab);

})();