const { Plugin } = require('powercord/entities');

const {
  getModule,
  getModuleByDisplayName,
  React,
  constants
} = require('powercord/webpack');

const { Menu } = require('powercord/components');

const Permissions = Object.assign({}, constants.Permissions); // eslint-disable-line no-shadow

if (Permissions.MANAGE_GUILD) {
  Permissions.MANAGE_SERVER = Permissions.MANAGE_GUILD;

  delete Permissions.MANAGE_GUILD;
}

const { inject, uninject } = require('powercord/injector');

module.exports = class PermissionViewer extends Plugin {
  async import (filter, functionName = filter) {
    if (typeof filter === 'string') {
      filter = [ filter ];
    }

    this[functionName] = (await getModule(filter))[functionName];
  }

  async doImport () {
    await this.import('Messages');
    await this.import('getMember');
    await this.import('getGuild');
  }

  /* Whether or not permissions that are implied (by administrator) should be shown as well */
  impliedPermissions = true;

  getAllPermissionsRaw() {
    return Object.values(Permissions).reduce((a, b) => a | b, 0n);
  }

  getPermissionsRaw (guildId, userId) {
    let permissions = 0n;

    const guild = this.getGuild(guildId);
    const member = this.getMember(guildId, userId);

    if (guild && member) {
      if (guild.ownerId === userId) {
        /* If they are the owner they have all the permissions */
        return this.getAllPermissionsRaw();
      }
      
      /* @everyone is not inlcuded in the member's roles */
      permissions |= guild.roles[guild.id].permissions;

      for (const roleId of member.roles) {
        permissions |= guild.roles[roleId].permissions;
      }

      if (this.impliedPermissions) {
        if ((permissions & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
          return this.getAllPermissionsRaw();
        }
      }
    }

    return permissions;
  }

  toTitleCase (str) {
    return str.replace(
      /\w\S*/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  getPermissions (guildId, userId) {
    const raw = this.getPermissionsRaw(guildId, userId);

    const permissions = {
      raw,
      entries: []
    };

    Object.keys(Permissions).forEach(key => {
      if ((raw & Permissions[key]) === Permissions[key]) {
        permissions.entries.push({
          key,
          readable: this.Messages[key] || this.toTitleCase(key.replace(/_/g, ' ')),
          raw: Permissions[key]
        });
      }
    });

    return permissions;
  }

  getRolesWithPermission (guildId, permissions, roles = null) {
    const withPermissions = [];
    const guild = this.getGuild(guildId);

    if (!roles) {
      roles = guild.roles; // eslint-disable-line prefer-destructuring
    }

    for (let role of roles) {
      if (typeof role === 'string') {
        role = guild.roles[role];
      }

      if (role) {
        const rolePermissions = role.permissions;
        if ((rolePermissions & permissions) === permissions) {
          withPermissions.push(role);
        } else if (this.impliedPermissions) {
          if ((rolePermissions & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
            withPermissions.push(role);
          }
        }
      }
    }

    return withPermissions;
  }

  // From https://github.com/NurMarvin/guild-profile/blob/89e59764112844d4dc51c97aa4e58978ec7436ae/index.js#L170
  _injectOpenContextMenuLazy (menus) {
    const module = getModule([ 'openContextMenuLazy' ], false);

    inject('permission-viewer-context-lazy-menu', module, 'openContextMenuLazy', ([ event, lazyRender, params ]) => {
      const warpLazyRender = async () => {
        const render = await lazyRender(event);

        return (config) => {
          const menu = render(config);
          const menuName = menu?.type?.displayName;

          if (menuName) {
            const moduleByDisplayName = getModuleByDisplayName(menuName, false);

            if (menuName in menus) {
              menus[menuName]();
              delete menus[menuName];
            }
            if (moduleByDisplayName !== null) {
              menu.type = moduleByDisplayName;
            }
          }
          return menu;
        };
      };

      return [ event, warpLazyRender, params ];
    }, true);
  }

  _injectContextMenu () {
    const GuildChannelUserContextMenu = getModule(m => m.default && m.default.displayName === 'GuildChannelUserContextMenu', false);
    inject('permission-viewer-user', GuildChannelUserContextMenu, 'default', (args, res) => {
      const { children } = res.props.children.props;
      // Attempt to find the context menu area containing the "Roles" item.
      // If no such area is found (i.e. the user has no roles), then fall back
      // to using the next menu area after the one containing "Block" or "Unblock"
      // (the ID is the same regardless of whether a user is blocked).
      let childIndex = 0;
      let blockAreaIndex = 0;
      const rolesMenuArea = children.find(item => {
        ++childIndex;
        // If the item is empty, we know it's not it
        if (!item) {
          return false;
        }
        // The one we're looking for has an array of children
        if (!Array.isArray(item.props.children)) {
          return false;
        }
        return item.props.children.some(c => {
          if (c && c.props) {
            if (c.props.id === 'roles') {
              return true;
            } else if (c.props.id === 'block' || c.props.id === 'change-nickname') {
              blockAreaIndex = childIndex;
            }
          }
          return false;
        });
      }) ?? children[blockAreaIndex + 1];

      const { guildId } = args[0];
      const userId = args[0].user.id;

      const member = this.getMember(guildId, userId);
      if (member) {
        const permissions = this.getPermissions(guildId, userId);

        const items = [];

        if (permissions.raw === 0n) {
          items.push(React.createElement(Menu.MenuItem, {
            id: 'none',
            label: 'None'
          }));
        }

        for (const permission of permissions.entries) {
          const roles = this.getRolesWithPermission(guildId, permission.raw, member.roles.concat([ guildId ]));

          if (roles.length > 0) {
            items.push(React.createElement(Menu.MenuItem, {
              id: permission.key.toLowerCase(),
              label: permission.readable,
              children: roles.map(role => React.createElement(Menu.MenuItem, {
                id: role.id,
                label: React.createElement("span", {
                  style: {
                    color: role.colorString
                  }
                }, role.name)
              }))
            }));
          } else {
            items.push(React.createElement(Menu.MenuItem, {
              id: permission.readable.toLowerCase(),
              label: permission.readable
            }));
          }
        }

        rolesMenuArea.props.children.push(React.createElement(Menu.MenuItem, {
          id: 'permissions',
          label: 'Permissions',
          children: items
        }));
      }

      return res;
    });
    GuildChannelUserContextMenu.default.displayName = 'GuildChannelUserContextMenu';
  }

  async startPlugin () {
    await this.doImport();

    this._injectOpenContextMenuLazy({
      GuildChannelUserContextMenu: this._injectContextMenu.bind(this)
    });
  }

  pluginWillUnload () {
    uninject('permission-viewer-context-lazy-menu');
    uninject('permission-viewer-user');
  }
};
