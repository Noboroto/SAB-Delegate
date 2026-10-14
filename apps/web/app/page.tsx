import { redirect } from 'next/navigation';

/** The app has no landing page: signed in goes to the picker, signed out to login (the picker's layout decides). */
export default function HomePage(): never {
  redirect('/servers');
}
