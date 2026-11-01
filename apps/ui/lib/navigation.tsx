import { forwardRef, useMemo, type ComponentPropsWithoutRef } from "react";
import { useSWRConfig } from "swr";
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useRevalidator,
} from "react-router-dom";

export { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";

type LinkProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean | null;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, prefetch: _prefetch, scroll: _scroll, ...props },
  ref,
) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) {
    return <a ref={ref} href={href} {...props} />;
  }
  return <RouterLink ref={ref} to={href} replace={replace} {...props} />;
});

export default Link;

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useHistory() {
  const navigate = useNavigate();
  return useMemo(() => ({
    getState: () => (window.history.state?.usr ?? null) as Record<string, unknown> | null,
    push: (href: string, state: Record<string, unknown> | null) => { void navigate(href, { state, preventScrollReset: true }); },
    replace: (href: string, state: Record<string, unknown> | null) => { void navigate(href, { state, replace: true, preventScrollReset: true }); },
  }), [navigate]);
}

export function useRouter() {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const { mutate } = useSWRConfig();
  return useMemo(() => ({
    push: (href: string, options?: { scroll?: boolean }) => { void navigate(href, { preventScrollReset: options?.scroll === false }); },
    replace: (href: string, options?: { scroll?: boolean }) => { void navigate(href, { replace: true, preventScrollReset: options?.scroll === false }); },
    back: () => { void navigate(-1); },
    forward: () => { void navigate(1); },
    refresh: () => { void revalidate(); void mutate(() => true); },
  }), [navigate, revalidate, mutate]);
}
