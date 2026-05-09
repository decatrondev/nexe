import { useState } from "react";
import ServerSidebar from "../components/ServerSidebar";
import ChannelList, { type Category } from "../components/ChannelList";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";
import { useAuthStore } from "../stores/auth";

// ---- Mock data ----

const mockServers = [
  { id: "1", name: "Nexe Dev" },
  { id: "2", name: "Gaming Hub" },
  { id: "3", name: "Music Lounge" },
];

const mockCategories: Category[] = [
  {
    id: "cat1",
    name: "Text Channels",
    channels: [
      { id: "ch1", name: "general", type: "text" },
      { id: "ch2", name: "clips", type: "text" },
      { id: "ch3", name: "gaming", type: "text" },
    ],
  },
  {
    id: "cat2",
    name: "Development",
    channels: [
      { id: "ch4", name: "frontend", type: "text" },
      { id: "ch5", name: "backend", type: "text" },
      { id: "ch6", name: "devops", type: "text" },
    ],
  },
  {
    id: "cat3",
    name: "Voice Channels",
    channels: [
      { id: "ch7", name: "Lobby", type: "voice" },
      { id: "ch8", name: "Gaming", type: "voice" },
    ],
  },
];

const mockMessages = [
  {
    id: "m1",
    author: "Alice",
    authorColor: "#a78bfa",
    content: "Hey everyone! Welcome to Nexe.",
    timestamp: "Today at 10:30 AM",
  },
  {
    id: "m2",
    author: "Alice",
    authorColor: "#a78bfa",
    content: "This is the new chat platform we've been working on.",
    timestamp: "Today at 10:30 AM",
  },
  {
    id: "m3",
    author: "Bob",
    authorColor: "#34d399",
    content: "Looks great so far! Love the dark theme.",
    timestamp: "Today at 10:32 AM",
  },
  {
    id: "m4",
    author: "Charlie",
    authorColor: "#f472b6",
    content: "When are we adding voice chat?",
    timestamp: "Today at 10:35 AM",
  },
  {
    id: "m5",
    author: "Alice",
    authorColor: "#a78bfa",
    content: "Soon! The backend is almost ready.",
    timestamp: "Today at 10:36 AM",
  },
  {
    id: "m6",
    author: "Dave",
    authorColor: "#60a5fa",
    content: "Just joined. This is really clean.",
    timestamp: "Today at 10:40 AM",
  },
  {
    id: "m7",
    author: "Bob",
    authorColor: "#34d399",
    content: "The channel organization reminds me of Discord. Very intuitive.",
    timestamp: "Today at 10:42 AM",
  },
  {
    id: "m8",
    author: "Eve",
    authorColor: "#fbbf24",
    content: "Has anyone tried the Twitch integration yet?",
    timestamp: "Today at 10:45 AM",
  },
  {
    id: "m9",
    author: "Charlie",
    authorColor: "#f472b6",
    content: "Not yet, but I saw it in the roadmap. Exciting stuff.",
    timestamp: "Today at 10:47 AM",
  },
];

const mockMembers = [
  { id: "u1", username: "Alice", status: "online" as const, role: "Admin" },
  { id: "u2", username: "Bob", status: "online" as const },
  { id: "u3", username: "Charlie", status: "idle" as const },
  { id: "u4", username: "Dave", status: "online" as const },
  { id: "u5", username: "Eve", status: "dnd" as const },
  { id: "u6", username: "Frank", status: "offline" as const },
  { id: "u7", username: "Grace", status: "offline" as const },
];

// ---- Component ----

export default function HomePage() {
  const [activeServerId, setActiveServerId] = useState<string | null>("1");
  const [activeChannelId, setActiveChannelId] = useState<string | null>("ch1");
  const user = useAuthStore((s) => s.user);

  const activeChannel = mockCategories
    .flatMap((c) => c.channels)
    .find((ch) => ch.id === activeChannelId);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ServerSidebar
        servers={mockServers}
        activeServerId={activeServerId}
        onSelectServer={(id) => setActiveServerId(id || null)}
      />
      <ChannelList
        serverName={
          mockServers.find((s) => s.id === activeServerId)?.name || "Home"
        }
        categories={mockCategories}
        activeChannelId={activeChannelId}
        onSelectChannel={setActiveChannelId}
        username={user?.username || "User"}
        userStatus="online"
      />
      <ChatArea
        channelName={activeChannel?.name || "general"}
        messages={mockMessages}
      />
      <MemberList members={mockMembers} />
    </div>
  );
}
