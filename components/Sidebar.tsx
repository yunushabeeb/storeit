'use client';

import Link from 'next/link';
import Image from 'next/image';
import { navItems } from '@/constants';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { signOutEverywhere } from '@/lib/actions/user.actions';

const Sidebar = ({ fullName, avatar, email }: SidebarProps) => {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/">
        <Image
          src="/assets/icons/logo-full-brand.svg"
          alt="logo"
          width={160}
          height={50}
          className="hidden h-auto lg:block"
        />

        <Image
          src="/assets/icons/logo-brand.svg"
          alt="logo"
          width={52}
          height={52}
          className="lg:hidden"
        />
      </Link>

      <nav className="sidebar-nav">
        <ul className="flex flex-1 flex-col gap-6">
          {navItems.map(({ url, name, icon }) => (
            <Link key={name} href={url} className="lg:w-full">
              <li
                className={cn(
                  'sidebar-nav-item',
                  pathname === url && 'shad-active',
                )}
              >
                <Image
                  src={icon}
                  alt={name}
                  width={24}
                  height={24}
                  className={cn(
                    'nav-icon',
                    pathname === url && 'nav-icon-active',
                  )}
                />
                <p className="hidden lg:block">{name}</p>
              </li>
            </Link>
          ))}
        </ul>
      </nav>

      <Image
        src="/assets/images/files-2.png"
        alt="logo"
        width={506}
        height={418}
        className="w-full"
      />

      <div className="sidebar-user-info">
        <Image
          src={avatar}
          alt="Avatar"
          width={44}
          height={44}
          className="sidebar-user-avatar"
        />
        <div className="hidden lg:block">
          <p className="subtitle-2 capitalize">{fullName}</p>
          <p className="caption">{email}</p>
        </div>
      </div>
      {/* Ends every session, including other browsers. Hidden on the narrow
          rail; the header carries the same action until the sidebar is wide. */}
      <Button
        type="button"
        className="mt-3 hidden h-10 w-full rounded-full bg-brand/10 px-3 text-xs text-brand hover:bg-brand/20 lg:flex"
        title="Sign out everywhere"
        onClick={() => signOutEverywhere()}
      >
        Sign out everywhere
      </Button>
    </aside>
  );
};
export default Sidebar;
