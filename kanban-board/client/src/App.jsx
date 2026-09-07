import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import Login from './auth/Login';
import Signup from './auth/Signup';
import BoardList from './BoardList';
import BoardDetail from './BoardDetail';
import TeamMembers from './TeamMembers';
import MyTasks from './MyTasks';
import Sidebar from './Sidebar';
import { api } from './api';
import './App.css';

const TEAM_STORAGE_KEY = 'kanban_current_team';

function AuthGate() {
  const [showSignup, setShowSignup] = useState(false);
  return showSignup
    ? <Signup onSwitchToLogin={() => setShowSignup(false)} />
    : <Login onSwitchToSignup={() => setShowSignup(true)} />;
}

function AuthenticatedApp() {
  const [teams, setTeams] = useState(null);
  const [currentTeamId, setCurrentTeamId] = useState(() => localStorage.getItem(TEAM_STORAGE_KEY));
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [view, setView] = useState('boards'); // 'boards' | 'members' | 'myTasks'
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadTeams = () => api.getMyTeams().then(setTeams).catch(e => setError(e.message));

  useEffect(() => { loadTeams(); }, []);

  // Once teams load, make sure the "current" team is actually one of theirs
  // (it may have been removed since, or never set for a first-time user).
  useEffect(() => {
    if (!teams) return;
    if (!teams.some(t => t._id === currentTeamId)) {
      setCurrentTeamId(teams[0]?._id ?? null);
    }
  }, [teams]);

  useEffect(() => {
    if (currentTeamId) localStorage.setItem(TEAM_STORAGE_KEY, currentTeamId);
  }, [currentTeamId]);

  const handleSwitchTeam = (teamId) => {
    setCurrentTeamId(teamId);
    setSelectedBoardId(null);
    setView('boards');
  };

  // The sidebar shows the new team the instant the form submits, using a
  // temp id swapped for the real one once the POST resolves — the creator
  // is always the owner, so that much is known before the request even
  // goes out. Switching the active team still waits for the real id, since
  // BoardList would otherwise fetch boards for an id that doesn't exist yet.
  const handleCreateTeam = async (name) => {
    const tempId = `temp-${Date.now()}`;
    setTeams(prev => [...(prev || []), { _id: tempId, name, role: 'owner', isOwner: true }]);

    try {
      const team = await api.createTeam(name);
      setTeams(prev => prev.map(t => (t._id === tempId ? { ...team, role: 'owner', isOwner: true } : t)));
      setCurrentTeamId(team._id);
    } catch (e) {
      setError(e.message);
      setTeams(prev => prev.filter(t => t._id !== tempId));
    }
  };

  // After deleting the current team, drop back to the boards view and
  // remove it from local state right away — the effect above then picks a
  // remaining team (or falls through to the "no teams yet" empty state if
  // none are left). No reload needed: TeamMembers already fires the delete
  // request itself, so this is just reflecting a change already in flight.
  const handleTeamDeleted = (teamId) => {
    setView('boards');
    setSelectedBoardId(null);
    setTeams(prev => (prev || []).filter(t => t._id !== teamId));
  };

  // My Tasks spans every team, so opening one from there has to switch the
  // active team first (its board wouldn't otherwise be reachable) before
  // landing on that specific board.
  const handleOpenTask = (teamId, boardId) => {
    setCurrentTeamId(teamId);
    setSelectedBoardId(boardId);
    setView('boards');
  };

  if (!teams) return <p style={{ padding: 24 }}>{error || 'Loading…'}</p>;

  const currentTeam = teams.find(t => t._id === currentTeamId);

  return (
    <div className="app-shell">
      <button className="mobile-menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <Sidebar
        teams={teams}
        currentTeamId={currentTeamId}
        onSwitchTeam={handleSwitchTeam}
        onCreateTeam={handleCreateTeam}
        view={view}
        onChangeView={(v) => { setView(v); setSelectedBoardId(null); }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="main-content">
        {view === 'myTasks' ? (
          <MyTasks onOpenTask={handleOpenTask} />
        ) : !currentTeam ? (
          <div className="empty-state">
            <h1>No teams yet</h1>
            <p>Create a team from the sidebar to start adding boards.</p>
          </div>
        ) : view === 'members' ? (
          <TeamMembers team={currentTeam} onTeamDeleted={handleTeamDeleted} />
        ) : selectedBoardId ? (
          <BoardDetail boardId={selectedBoardId} onBack={() => setSelectedBoardId(null)} />
        ) : (
          <BoardList teamId={currentTeam._id} onOpenBoard={setSelectedBoardId} role={currentTeam.role} />
        )}
      </main>
    </div>
  );
}

function App() {
  const { user, loading } = useAuth();

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!user) return <AuthGate />;
  return <AuthenticatedApp />;
}

export default App;
