/** The cloud panel: save the open project, open or delete saved ones, sign out. */
import type { App } from './app';
import { h, showDialog, toast } from './dom';

export function openCloudDialog(app: App): void {
  const cloud = app.cloud;
  const user = app.user;
  if (!cloud || !user) return;
  const list = h('div', {}, h('p', { class: 'hint' }, 'Loading your cloud projects…'));
  const linked = app.isCloudLinked();
  const saveBtn = h(
    'button',
    {
      class: 'primary',
      onclick: async () => {
        saveBtn.disabled = true;
        if (await app.saveToCloud()) {
          toast(`Saved “${app.project.name}” to the cloud`);
          await refresh();
        }
        saveBtn.disabled = false;
      },
    },
    linked ? '☁ Save now' : '☁ Save this project to the cloud',
  );

  const refresh = async () => {
    try {
      const items = await cloud.listProjects();
      if (!items.length) {
        list.replaceChildren(h('p', { class: 'hint' }, 'Nothing saved yet.'));
        return;
      }
      const table = h('table', {}, h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Maps'), h('th', {}, 'Size'), h('th', {}, 'Saved'), h('th', {})));
      for (const p of items) {
        const isOpen = p.id === app.project.id;
        table.append(
          h(
            'tr',
            {},
            h('td', {}, isOpen ? h('b', {}, `${p.name} (open)`) : p.name),
            h('td', {}, String(p.mapCount)),
            h('td', {}, `${Math.max(1, Math.round(p.bytes / 1024))} KB`),
            h('td', {}, p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—'),
            h(
              'td',
              {},
              h(
                'button',
                {
                  disabled: isOpen,
                  onclick: async () => {
                    try {
                      const { project, migrated } = await cloud.loadProject(p.id);
                      app.replaceProject(project, { cloud: true });
                      // Store a converted project back in its new form.
                      if (migrated.length) void app.saveToCloud();
                      toast(migrated.length ? `Opened “${project.name}” and converted ${migrated.length} RPG-DC map(s)` : `Opened “${project.name}” from the cloud`);
                      (document.getElementById('dialog') as HTMLDialogElement).close();
                    } catch (e) {
                      toast(cloud.describeError(e));
                    }
                  },
                },
                'Open',
              ),
              ' ',
              h(
                'button',
                {
                  class: 'danger',
                  onclick: async () => {
                    if (!confirm(`Delete “${p.name}” from the cloud? Copies in this browser or saved files are not affected.`)) return;
                    try {
                      await cloud.deleteProject(p.id);
                      if (isOpen) app.unlinkCloud();
                      await refresh();
                    } catch (e) {
                      toast(cloud.describeError(e));
                    }
                  },
                },
                'Delete',
              ),
            ),
          ),
        );
      }
      list.replaceChildren(table);
    } catch (e) {
      list.replaceChildren(h('p', { class: 'hint' }, `Could not load projects: ${cloud.describeError(e)}`));
    }
  };

  const body = h(
    'div',
    {},
    user.guest
      ? h(
          'div',
          {},
          h('p', { class: 'hint' }, 'You are signed in as a guest. Guest projects belong to this browser only — link a Google account to keep them and open them on other devices.'),
          h('div', { class: 'btn-row' }, h('button', { onclick: () => void app.upgradeGuest().then(() => refresh()) }, 'Link Google account')),
        )
      : h('p', { class: 'hint' }, `Signed in as ${user.name}${user.email && user.email !== user.name ? ` (${user.email})` : ''}.`),
    h('h3', {}, `Open project: ${app.project.name}`),
    h(
      'p',
      { class: 'hint' },
      linked
        ? 'This project is synced: changes are saved to the cloud automatically a few seconds after you make them.'
        : 'Save it once and it will keep syncing automatically while you are signed in.',
    ),
    h('div', { class: 'btn-row' }, saveBtn),
    h('h3', {}, 'Your cloud projects'),
    list,
  );
  showDialog('Cloud saves', body, [
    {
      label: 'Sign out',
      action: async () => {
        if (app.user?.guest && !confirm('Signing out of a guest account loses access to its cloud projects for good (link a Google account first to keep them). Sign out anyway?')) return false;
        await cloud.signOutUser();
        toast('Signed out — your work stays in this browser');
      },
    },
    { label: 'Close', primary: true },
  ]);
  void refresh();
}

/** Choose Google or guest sign-in. */
export function openSignInDialog(app: App): void {
  const cloud = app.cloud;
  if (!cloud) return;
  // Sign-in must start inside the click handler (before any await) or browsers block the popup.
  const run = (start: () => Promise<void>) => () => {
    start().catch((e) => toast(cloud.describeError(e)));
  };
  showDialog(
    'Save your worlds to the cloud',
    h(
      'div',
      {},
      h('p', {}, h('b', {}, 'Google account'), ' — your projects follow you to any device.'),
      h('p', {}, h('b', {}, 'Guest'), ' — no account needed; projects are kept for this browser. You can link a Google account later without losing anything.'),
    ),
    [
      { label: 'Cancel' },
      { label: 'Continue as guest', action: run(() => cloud.signInAsGuest()) },
      { label: 'Sign in with Google', primary: true, action: run(() => cloud.signIn()) },
    ],
  );
}
