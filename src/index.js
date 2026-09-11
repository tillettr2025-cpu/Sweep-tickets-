import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

/* =========================
   TICKET COMMAND
========================= */

const ticketCommand = {
  name: 'ticket',
  description: 'Manage the ticket system',
  options: [
    {
      name: 'setup',
      description: 'Create the ticket panel',
      type: 1,
      default_member_permissions:
        PermissionFlagsBits.ManageChannels.toString(),
    },
    {
      name: 'close',
      description: 'Close the current ticket',
      type: 1,
    },
    {
      name: 'delete',
      description: 'Delete the current ticket',
      type: 1,
    },
    {
      name: 'rename',
      description: 'Rename the current ticket',
      type: 1,
      options: [
        {
          name: 'name',
          description: 'New ticket name',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'add',
      description: 'Add a user to the current ticket',
      type: 1,
      options: [
        {
          name: 'user',
          description: 'User to add',
          type: 6,
          required: true,
        },
      ],
    },
    {
      name: 'remove',
      description: 'Remove a user from the current ticket',
      type: 1,
      options: [
        {
          name: 'user',
          description: 'User to remove',
          type: 6,
          required: true,
        },
      ],
    },
  ],
};

client.commands.set('ticket', ticketCommand);

/* =========================
   READY
========================= */

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [ticketCommand],
      }
    );

    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }

  client.user.setPresence({
    activities: [
      {
        name: 'Managing Tickets',
        type: 0,
      },
    ],
    status: 'online',
  });
});

/* =========================
   SLASH COMMANDS
========================= */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== 'ticket') return;

  const subcommand = interaction.options.getSubcommand();

  /* =========================
     /ticket setup
  ========================= */

  if (subcommand === 'setup') {
    if (
      !interaction.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      )
    ) {
      return interaction.reply({
        content: '❌ You need **Manage Channels** to use this.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Support Tickets')
      .setDescription(
        'Need help? Open a ticket using the button below.\n\n' +
        '🛠️ **Support**\n' +
        'Get help from our staff team.\n\n' +
        '🐛 **Report a Bug**\n' +
        'Report bugs or problems.\n\n' +
        '📢 **Other**\n' +
        'Anything else you need help with.'
      )
      .setFooter({
        text: 'Please do not open unnecessary tickets.',
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_create')
        .setLabel('Open Ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });

    return interaction.reply({
      content: '✅ Ticket panel created!',
      ephemeral: true,
    });
  }

  /* =========================
     /ticket close
  ========================= */

  if (subcommand === 'close') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket.',
        ephemeral: true,
      });
    }

    await interaction.reply(
      '🔒 This ticket will be deleted in **5 seconds**.'
    );

    setTimeout(async () => {
      await interaction.channel.delete().catch(() => {});
    }, 5000);

    return;
  }

  /* =========================
     /ticket delete
  ========================= */

  if (subcommand === 'delete') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket.',
        ephemeral: true,
      });
    }

    await interaction.reply('🗑️ Deleting ticket...');

    setTimeout(async () => {
      await interaction.channel.delete().catch(() => {});
    }, 2000);

    return;
  }

  /* =========================
     /ticket rename
  ========================= */

  if (subcommand === 'rename') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket.',
        ephemeral: true,
      });
    }

    const name = interaction.options.getString('name');

    await interaction.channel.setName(
      `ticket-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
    );

    return interaction.reply({
      content: `✅ Ticket renamed to **${name}**.`,
    });
  }

  /* =========================
     /ticket add
  ========================= */

  if (subcommand === 'add') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user');

    await interaction.channel.permissionOverwrites.create(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });

    return interaction.reply({
      content: `✅ Added ${user} to this ticket.`,
    });
  }

  /* =========================
     /ticket remove
  ========================= */

  if (subcommand === 'remove') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user');

    await interaction.channel.permissionOverwrites.delete(user.id);

    return interaction.reply({
      content: `✅ Removed ${user} from this ticket.`,
    });
  }
});

/* =========================
   TICKET BUTTON
========================= */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  /* =========================
     CREATE TICKET
  ========================= */

  if (interaction.customId === 'ticket_create') {
    const guild = interaction.guild;

    const existingTicket = guild.channels.cache.find(
      (channel) =>
        channel.name === `ticket-${interaction.user.username.toLowerCase()}`
    );

    if (existingTicket) {
      return interaction.reply({
        content: `❌ You already have a ticket: ${existingTicket}`,
        ephemeral: true,
      });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Created')
      .setDescription(
        `Welcome ${interaction.user}!\n\n` +
        'Please explain your issue and a staff member will assist you.\n\n' +
        '🔒 Use the button below when you are finished.'
      )
      .setFooter({
        text: 'Ticket System',
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `${interaction.user}`,
      embeds: [embed],
      components: [row],
    });

    return interaction.reply({
      content: `✅ Your ticket has been created: ${ticketChannel}`,
      ephemeral: true,
    });
  }

  /* =========================
     CLOSE TICKET BUTTON
  ========================= */

  if (interaction.customId === 'ticket_close') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content: '❌ This is not a ticket.',
        ephemeral: true,
      });
    }

    await interaction.reply(
      '🔒 Ticket closed. Deleting in **5 seconds**...'
    );

    setTimeout(async () => {
      await interaction.channel.delete().catch(() => {});
    }, 5000);
  }
});

/* =========================
   LOGIN
========================= */

client.login(process.env.DISCORD_TOKEN);
