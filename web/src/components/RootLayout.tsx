import { Outlet } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { ShellProvider } from "@/components/ShellProvider";

export function RootLayout() {
  return (
    <ShellProvider>
      <Shell>
        <Outlet />
      </Shell>
    </ShellProvider>
  );
}
