const { Plugin } = require('powercord/entities');

const {
  getModule,
  React,
  constants
} = require('powercord/webpack');

const { Menu } = require('powercord/components');

const Permissions = Object.assign({}, constants.Permissions); // eslint-disable-line no-shadow

if (Permissions.SEND_TSS_MESSAGES) {
  Permissions.SEND_TTS_MESSAGES = Permissions.SEND_TSS_MESSAGES;

  delete Permissions.SEND_TSS_MESSAGES;
}

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

  getPermissionsRaw (guildId, userId) {
    let permissions = 0;

    const guild = this.getGuild(guildId);
    const member = this.getMember(guildId, userId);

    if (guild && member) {
      if (guild.ownerId === userId) {
        permissions = Permissions.ADMINISTRATOR;
      } else {
        /* @everyone is not inlcuded in the member's roles */
        permissions |= guild.roles[guild.id].permissions;

        for (const roleId of member.roles) {
          permissions |= guild.roles[roleId].permissions;
        }
      }

      /* If they have administrator they have every permission */
      if ((permissions & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
        return Object.values(Permissions).reduce((a, b) => a | b, 0);
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
      if ((raw & parseInt(Permissions[key].data)) === parseInt(Permissions[key].data)) {
        permissions.entries.push({
          key,
          readable: this.Messages[key] || this.toTitleCase(key.replace(/_/g, ' ')),
          raw: parseInt(Permissions[key].data)
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
        if ((role.permissions & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR || (role.permissions & permissions) === permissions) {
          withPermissions.push(role);
        }
      }
    }

    return withPermissions;
  }

  createLabel (name, additional) {
    return Object.assign({
      type: 'button',
      name,
      onClick: () => {} // eslint-disable-line no-empty-function
    }, additional);
  }

  async startPlugin () {
    await this.doImport();

    const _this = this;

    const GuildChannelUserContextMenu = await getModule(m => m.default && m.default.displayName === 'GuildChannelUserContextMenu');
    inject('jockie-permissionViewer-user', GuildChannelUserContextMenu, 'default', (args, res) => { // eslint-disable-line func-names
      const { children } = res.props.children.props;
      const rolesMenuArea = children.find(item => {
        // If the item is empty, we know it's not it
        if (!item) {
          return false;
        }
        // The one we're looking for has an array of children
        if (!Array.isArray(item.props.children)) {
          return false;
        }
        return item.props.children.some(c => c && c.props.id === 'roles');
      });

      const { guildId } = args[0];
      const userId = args[0].user.id;

      const member = _this.getMember(guildId, userId);
      if (member) {
        const permissions = _this.getPermissions(guildId, userId);

        const items = [];

        if (permissions.raw === 0) {
          items.push(React.createElement(Menu.MenuItem, {
            id: 'none',
            label: 'None'
          }));
        }

        for (const permission of permissions.entries) {
          const roles = _this.getRolesWithPermission(guildId, permission.raw, member.roles.concat([ guildId ]));

          if (roles.length > 0) {
            items.push(React.createElement(Menu.MenuItem, {
              id: permission.readable.toLowerCase(),
              label: permission.readable,
              children: roles.map(role => React.createElement(Menu.MenuItem, {
                key: role.name.toLowerCase().replace(/ /g, ''),
                label: role.name
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
  }

  pluginWillUnload () {
    uninject('jockie-permissionViewer-user');
  }
};
