import { useEffect, useState } from "react";
import ServerSidebar from "../components/ServerSidebar";
import ChannelList from "../components/ChannelList";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";
import CreateGuildModal from "../components/CreateGuildModal";
import JoinServerModal from "../components/JoinServerModal";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { nexeWS } from "../lib/websocket";
import { api, type Message } from "../lib/api";

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
  const token = useAuthStore((s) => s.token);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  // Detect ?invite=CODE in URL or localStorage (saved before login redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite") || localStorage.getItem("pendingInvite");
    if (code) {
      setInviteCode(code);
      localStorage.removeItem("pendingInvite");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    loadGuilds();
    // Register current user's username in the guild store
    if (user) {
      useGuildStore.setState((s) => ({
        usernames: { ...s.usernames, [user.id]: user.displayName || user.username },
      }));
    }

    // Connect WebSocket
    if (token) {
      nexeWS.connect(token);

      nexeWS.on("MESSAGE_CREATE", (data) => {
        const msg = data as Message;
        useGuildStore.setState((s) => {
          const channelMsgs = s.messages[msg.channelId] || [];
          if (channelMsgs.some((m) => m.id === msg.id)) return s;
          return {
            messages: {
              ...s.messages,
              [msg.channelId]: [...channelMsgs, msg],
            },
          };
        });
        // Resolve username if unknown
        const { usernames } = useGuildStore.getState();
        if (!usernames[msg.authorId]) {
          api.getProfile(msg.authorId).then((p) => {
            useGuildStore.setState((s) => ({
              usernames: {
                ...s.usernames,
                [msg.authorId]: p?.displayName || p?.username || "User",
              },
            }));
          }).catch(() => {});
        }
      });

      nexeWS.on("MESSAGE_UPDATE", (data) => {
        const msg = data as Message;
        useGuildStore.setState((s) => {
          const channelMsgs = s.messages[msg.channelId];
          if (!channelMsgs) return s;
          return {
            messages: {
              ...s.messages,
              [msg.channelId]: channelMsgs.map((m) =>
                m.id === msg.id ? msg : m,
              ),
            },
          };
        });
      });

      nexeWS.on("MESSAGE_DELETE", (data) => {
        const { id, channelId } = data as { id: string; channelId: string };
        useGuildStore.setState((s) => {
          const channelMsgs = s.messages[channelId];
          if (!channelMsgs) return s;
          return {
            messages: {
              ...s.messages,
              [channelId]: channelMsgs.filter((m) => m.id !== id),
            },
          };
        });
      });

      nexeWS.on("GUILD_MEMBER_ADD", (data) => {
        const d = data as { userId: string; guildId: string };
        const currentUser = useAuthStore.getState().user;

        // If I just joined a server with Twitch integration, sync my roles
        if (d.userId === currentUser?.id && currentUser?.twitchId) {
          api.syncTwitchRoles(d.guildId).catch(() => {});
        }

        // Reload members if we're viewing this guild
        const activeGuild = useGuildStore.getState().activeGuildId;
        if (activeGuild === d.guildId) {
          api.getMembers(d.guildId, 100).then((members) => {
            useGuildStore.setState((s) => ({
              members: { ...s.members, [d.guildId]: Array.isArray(members) ? members : [] },
            }));
          }).catch(() => {});
        }
      });

      nexeWS.on("GUILD_MEMBER_REMOVE", (data) => {
        const d = data as { userId: string; guildId: string };
        const currentUser = useAuthStore.getState().user;
        if (d.userId === currentUser?.id) {
          // Current user was kicked/banned — remove guild from list
          useGuildStore.setState((s) => ({
            guilds: s.guilds.filter((g) => g.id !== d.guildId),
            activeGuildId:
              s.activeGuildId === d.guildId ? null : s.activeGuildId,
            activeChannelId:
              s.activeGuildId === d.guildId ? null : s.activeChannelId,
          }));
        } else {
          // Another member was kicked/banned — remove from member list
          useGuildStore.setState((s) => {
            const guildMembers = s.members[d.guildId];
            if (!guildMembers) return s;
            return {
              members: {
                ...s.members,
                [d.guildId]: guildMembers.filter(
                  (m) => m.userId !== d.userId,
                ),
              },
            };
          });
        }
      });

      nexeWS.on("GUILD_BAN_REMOVE", (_data) => {
        // Unban event — no immediate UI action needed since the user
        // is not currently a member. Could be used for mod log updates.
      });

      nexeWS.on("GUILD_ROLE_CREATE", (data) => {
        const d = data as { guildId: string; [key: string]: any };
        api.getRoles(d.guildId).then((roles) => {
          useGuildStore.setState((s) => ({
            roles: { ...s.roles, [d.guildId]: Array.isArray(roles) ? roles : [] },
          }));
        }).catch(() => {});
      });

      nexeWS.on("GUILD_ROLE_UPDATE", (data) => {
        const d = data as { guildId: string };
        api.getRoles(d.guildId).then((roles) => {
          useGuildStore.setState((s) => ({
            roles: { ...s.roles, [d.guildId]: Array.isArray(roles) ? roles : [] },
          }));
        }).catch(() => {});
      });

      nexeWS.on("GUILD_ROLE_DELETE", (data) => {
        const d = data as { roleId: string; guildId: string };
        useGuildStore.setState((s) => {
          const guildRoles = s.roles[d.guildId];
          if (!guildRoles) return s;
          return { roles: { ...s.roles, [d.guildId]: guildRoles.filter((r) => r.id !== d.roleId) } };
        });
      });

      nexeWS.on("GUILD_MEMBER_UPDATE", (data) => {
        const d = data as { userId: string; guildId: string; roleIds?: string[] };
        if (d.roleIds) {
          useGuildStore.setState((s) => ({
            memberRoles: { ...s.memberRoles, [d.userId]: d.roleIds! },
          }));
        }
      });
    }

    return () => {
      nexeWS.disconnect();
    };
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

      {inviteCode && (
        <JoinServerModal
          initialCode={inviteCode}
          onClose={() => setInviteCode(null)}
        />
      )}
    </div>
  );
}
