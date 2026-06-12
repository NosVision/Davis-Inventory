import { create } from 'zustand';
import type { AuthUser } from '@/lib/auth/permissions';
import { useAppStore } from './app-store';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  setLoading: (loading: boolean) => void;
  updateUser: (partial: Partial<Pick<AuthUser, 'displayName' | 'avatarUrl'>>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),
  logout: () => {
    set({ user: null, isLoading: false });
    // Clear the persisted store selection so the next account on this device
    // doesn't inherit a store it may not be authorized for.
    useAppStore.setState({ currentStoreId: null });
  },
}));
