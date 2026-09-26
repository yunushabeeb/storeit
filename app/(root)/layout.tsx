import { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import MobileNavigation from '@/components/MobileNavigation';
import Header from '@/components/Header';
import { getCurrentUser } from '@/lib/actions/user.actions';
import { redirect } from 'next/navigation';
import { Toaster } from '@/components/ui/toaster';

// The signed-in user comes from a cookie and the database. A static render
// would cache one person's layout for the next visitor.
export const dynamic = 'force-dynamic';

const Layout = async ({ children }: { children: ReactNode }) => {
  // Get the currently signed in user
  const currentUser = await getCurrentUser();

  // Every page under (root) requires a session. Auth pages live in (auth)
  // and do not use this layout, so the redirect cannot loop.
  if (!currentUser) return redirect('/sign-in');

  return (
    <main className="flex h-screen">
      <Sidebar {...currentUser} />

      <section className="flex h-full flex-1 flex-col">
        <MobileNavigation {...currentUser} />

        <Header userId={currentUser.$id} accountId={currentUser.accountId} />

        <div className="main-content">{children}</div>
      </section>

      <Toaster />
    </main>
  );
};

export default Layout;
