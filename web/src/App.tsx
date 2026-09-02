import { lazy, Suspense } from "react";
import { useRoute } from "./hooks/useRoute";
import { Nav } from "./components/Nav";
import { ConnectButton } from "./components/Connect";
const StreamsScreen = lazy(() => import("./screens/Streams").then((m) => ({ default: m.StreamsScreen })));
const StreamDetailScreen = lazy(() => import("./screens/StreamDetail").then((m) => ({ default: m.StreamDetailScreen })));
const CreateScreen = lazy(() => import("./screens/Create").then((m) => ({ default: m.CreateScreen })));
const AirdropScreen = lazy(() => import("./screens/Airdrop").then((m) => ({ default: m.AirdropScreen })));
const AccountScreen = lazy(() => import("./screens/Account").then((m) => ({ default: m.AccountScreen })));

const TITLES: Record<string, string> = {
  streams: "Streams",
  stream: "Stream",
  create: "Create a stream",
  airdrop: "Airdrop",
  account: "Account",
};

export default function App() {
  const [route] = useRoute();

  return (
    <div className="min-h-app bg-ink-900">
      <Nav route={route} />

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 sm:px-8 sm:pb-12 lg:px-10">
        <header className="mb-8 flex items-center justify-between gap-3">
          <div className="sm:hidden">
            <p className="eyebrow">BOT Chain</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink-50">{TITLES[route.name]}</h1>
          </div>
          <div className="hidden sm:block">
            <p className="eyebrow">Distribution protocol</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">{TITLES[route.name]}</h1>
          </div>
          <ConnectButton />
        </header>

        <Suspense fallback={<div className="py-8 text-center text-sm text-ink-400">Loading</div>}>
          {route.name === "streams" && <StreamsScreen />}
          {route.name === "stream" && <StreamDetailScreen id={route.id} />}
          {route.name === "create" && <CreateScreen />}
          {route.name === "airdrop" && <AirdropScreen />}
          {route.name === "account" && <AccountScreen />}
        </Suspense>
      </main>
    </div>
  );
}
