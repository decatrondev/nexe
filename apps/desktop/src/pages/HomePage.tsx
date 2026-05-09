import { useEffect, useState } from "react";
import ServerSidebar from "../components/ServerSidebar";
import ChannelList from "../components/ChannelList";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";
import CreateGuildModal from "../components/CreateGuildModal";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";

function WelcomeScreen({ onCreateServer }: { onCreateServer: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-dark-850">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-slate-100">
          Welcome to <span className="text-nexe-500">Nexe</span>
        </h1>
        <p className="mt-4 text-sm text-slate-400 leading-relaxed">
          You don&apos;t have any servers yet. Create your first server to start
          chatting with friends and communities.
        </p>
        <button
          onClick={onCreateServer}
          className="mt-6 rounded-lg bg-nexe-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-nexe-600"
        >
          Create Your First Server
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const loadGuilds = useGuildStore((s) => s.loadGuilds);
  const guilds = useGuildStore((s) => s.guilds);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const loading = useGuildStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadGuilds();
    // Register current user's username in the guild store
    if (user) {
      useGuildStore.setState((s) => ({
        usernames: { ...s.usernames, [user.id]: user.displayName || user.username },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showWelcome = guilds.length === 0 && !activeGuildId && !loading;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ServerSidebar />

      {showWelcome ? (
        <WelcomeScreen onCreateServer={() => setShowCreateModal(true)} />
      ) : (
        <>
          <ChannelList />
          <ChatArea />
          <MemberList />
        </>
      )}

      {showCreateModal && (
        <CreateGuildModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
