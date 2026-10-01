/**
 * Props contract of every theme slot (docs/theming.md). A theme replaces a slot by shipping
 * `<THEME_DIR>/slots/<Name>.tsx` with a default export of `(props: <Name>Props) => ReactNode`;
 * `src/theme/default/slots/<Name>.tsx` is the component used otherwise. Types only: safe to import
 * from a theme with `import type { HeaderProps } from "~/theme/slots"`.
 */
import type { ReactNode } from "react";
import type { PublicTheme } from "./load.ts";
import type { SLOT_NAMES } from "./schema.ts";

/** The identity of the deployment, as `theme.json` resolved it for the current language. */
export type ThemeBrand = Pick<
  PublicTheme,
  "name" | "tagline" | "logoUrl" | "supportEmail" | "projectUrl" | "legalLinks"
>;

export interface HeaderProps {
  brand: ThemeBrand;
  /** Account menu or sign-in link. Render it somewhere visible. */
  nav: ReactNode;
  /** Language picker (renders nothing when only one language is enabled). */
  localeSwitch: ReactNode;
  /** Light/dark toggle. */
  themeToggle: ReactNode;
}

export interface FooterProps {
  brand: ThemeBrand;
}

/** The signed-out landing page at `/`. Signed-in people are redirected to `/courses`. */
export interface HomeProps {
  brand: ThemeBrand;
  /** Set after a failed sign-in attempt; show a message when true. */
  loginFailed: boolean;
  /** Where the sign-in button points (`/auth/login`). */
  loginHref: string;
}

/** Frame around the sign-in, sign-up and password forms at `/login` and friends. */
export interface LoginPageProps {
  brand: ThemeBrand;
  title: string;
  /** Short explanation under the title, or null. */
  lead: string | null;
  /** The form(s) and links; place them inside the frame. */
  children: ReactNode;
}

/** Renders one `<li>`: the route owns the surrounding `<ul>`. */
export interface CourseCardProps {
  course: {
    slug: string;
    title: string;
    subtitle: string | null;
    status: "draft" | "published" | "archived";
    /** The viewer teaches or administers this course. */
    privileged: boolean;
    /** Why the course is not open yet ("Available from 12 March"), already translated; else null. */
    lockMessage: string | null;
    progress: { completed: number; total: number; ratio: number };
  };
}

export interface LessonLayoutProps {
  course: { slug: string; title: string };
  chapter: { title: string };
  lesson: { title: string; summary: string | null };
  position: { index: number; total: number };
  /** A teacher is previewing an unpublished lesson. */
  draftPreview: boolean;
  /** The blocks, or the lock notice when the lesson is not open. */
  children: ReactNode;
  /** Mark-as-done row and the previous/next bar (fixed to the viewport bottom). Render it after the content. */
  footer: ReactNode;
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
}

export interface SlotComponents {
  Header: HeaderProps;
  Footer: FooterProps;
  Home: HomeProps;
  LoginPage: LoginPageProps;
  CourseCard: CourseCardProps;
  LessonLayout: LessonLayoutProps;
  EmptyState: EmptyStateProps;
}

/** Compile-time check that the props table covers exactly the slot names the loader knows. */
export type _SlotNamesMatch = [(typeof SLOT_NAMES)[number]] extends [keyof SlotComponents]
  ? [keyof SlotComponents] extends [(typeof SLOT_NAMES)[number]]
    ? true
    : never
  : never;
