import React from 'react';
import { Button } from './ui/button';
import Image from 'next/image';
import Search from './Search';
import FileUploader from './FileUploader';
import { signOutEverywhere, signOutUser } from '@/lib/actions/user.actions';

const Header = ({ userId, accountId }: HeaderProps) => {
  return (
    <header className="header">
      <Search />
      <div className="header-wrapper">
        <FileUploader ownerId={userId} accountId={accountId} />
        {/* Same action as the sidebar button. Shown only while the sidebar is
            the narrow icon rail, which has no room for this label. */}
        <form
          action={async () => {
            'use server';

            await signOutEverywhere();
          }}
        >
          <Button
            type="submit"
            title="Sign out everywhere"
            className="hidden h-[52px] rounded-full bg-brand/10 px-4 text-sm text-brand shadow-none hover:bg-brand/20 sm:inline-flex lg:hidden"
          >
            Sign out everywhere
          </Button>
        </form>
        {/* Deletes only the session cookie on this browser. */}
        <form
          action={async () => {
            'use server';

            await signOutUser();
          }}
        >
          <Button type="submit" className="sign-out-button" title="Log out">
            <Image
              src="/assets/icons/logout.svg"
              alt="logo"
              width={24}
              height={24}
              className="w-6"
            />
          </Button>
        </form>
      </div>
    </header>
  );
};
export default Header;
