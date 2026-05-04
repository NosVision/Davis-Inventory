-- ==========================================
-- Fix chat room persistence: allow owner/manager to update rooms
-- ==========================================
--
-- Problem: The "Admins can update rooms" policy (set in 00008) only allowed
-- users whose chat_members.role = 'admin' to update chat_rooms. But the
-- client UI (chat-room-settings.tsx) treats profiles.role IN ('owner',
-- 'manager') as admin too. As a result, when an owner/manager renamed a room
-- or uploaded an avatar, Supabase silently rejected the UPDATE (0 rows
-- affected, no error). The local Zustand store was updated optimistically,
-- so the change appeared to work — but on refresh useChatRooms() refetched
-- from the DB and the old values came back.
--
-- This was effectively a regression of 00002's original policy:
--   "Managers update chat rooms" USING get_user_role() IN ('owner', 'manager')
--
-- Fix: allow EITHER chat-room admin OR profiles owner/manager. Apply the
-- same fix to chat_members INSERT/DELETE so add/remove member also works
-- for owner/manager (the same UI gates them with the same isAdmin check).
-- ==========================================

-- ---------- chat_rooms UPDATE ----------
DROP POLICY IF EXISTS "Admins can update rooms" ON chat_rooms;

CREATE POLICY "Admins can update rooms" ON chat_rooms FOR UPDATE
  USING (
    get_user_role() IN ('owner', 'manager')
    OR EXISTS (
      SELECT 1 FROM chat_members
      WHERE chat_members.room_id = chat_rooms.id
        AND chat_members.user_id = (SELECT auth.uid())
        AND chat_members.role = 'admin'
    )
  )
  WITH CHECK (
    get_user_role() IN ('owner', 'manager')
    OR EXISTS (
      SELECT 1 FROM chat_members
      WHERE chat_members.room_id = chat_rooms.id
        AND chat_members.user_id = (SELECT auth.uid())
        AND chat_members.role = 'admin'
    )
  );

-- ---------- chat_members INSERT ----------
DROP POLICY IF EXISTS "Admins can add members" ON chat_members;

CREATE POLICY "Admins can add members" ON chat_members FOR INSERT
  WITH CHECK (
    get_user_role() IN ('owner', 'manager')
    OR EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.room_id = chat_members.room_id
        AND cm.user_id = (SELECT auth.uid())
        AND cm.role = 'admin'
    )
    -- Self-insert allowed for room creation flow
    OR user_id = (SELECT auth.uid())
  );

-- ---------- chat_members DELETE ----------
DROP POLICY IF EXISTS "Admins can remove members" ON chat_members;

CREATE POLICY "Admins can remove members" ON chat_members FOR DELETE
  USING (
    get_user_role() IN ('owner', 'manager')
    OR EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.room_id = chat_members.room_id
        AND cm.user_id = (SELECT auth.uid())
        AND cm.role = 'admin'
    )
  );
