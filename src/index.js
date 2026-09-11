import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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
  AttachmentBuilder,
} from 'discord.js';

/* =========================
   CONFIG
========================= */

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const AUTO_CLOSE_HOURS = Number(process.env.AUTO_CLOSE_HOURS || 24);
const AUTO_WARN_HOURS = Number(process.env.AUTO_WARN_HOURS || 12);
const BRAND_FOOTER = process.env.BRAND_FOOTER || 'Ticket System';
const BRAND_THUMBNAIL = process.env.BRAND_THUMBNAIL || null;

const CATEGORIES = {
  support: {
    label: 'General Support',
    emoji: '🛠️',
    color: 0x5865f2,
    desc: 'Get help from our staff team.',
    style: ButtonStyle.Primary,
  },
  bug: {
    label: 'Player Report',
    emoji: '❗',
    color: 0xed4245,
    desc: 'Report bugs or problems.',
    style: ButtonStyle.Danger,
  },
  other: {
    label: 'Billing Support',
    emoji: '💳',
    color: 0x99aab5,
    desc: 'Anything else you need help with.',
    style: ButtonStyle.Secondary,
  },
};

const PRIORITIES = {
  low: { label: 'Low', emoji: '🟢', color: 0x57f287 },
  medium: { label: 'Medium', emoji: '🟡', color: 0xfee75c },
  high: { label: 'High', emoji: '🔴', color: 0xed4245 },
};

/* =========================
   PERSISTENCE (simple JSON file)
   NOTE: on Render's free tier the filesystem is ephemeral and
   resets on redeploy/restart, so tickets/stats won't survive
   a redeploy. Fine for casual use; use a real DB if you need
   this data to be durable.
========================= */

const DATA_PATH = path.join(process.cwd(), 'ticketdata.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return { tickets: {}, stats: {} };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Failed to save data:', err);
  }
}

let db = loadData();

function ensureStats(userId) {
  if (!db.stats[userId]) {
    db.stats[userId] = { claimed: 0, closed: 0, ratingTotal: 0, ratingCount: 0 };
  }
  return db.stats[userId];
}

/* =========================
   CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

/* =========================
   HELPERS
========================= */

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID)) return true;
  return false;
}

function sanitize(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
}

function findOpenTicket(guild, ownerId) {
  for (const [channelId, t] of Object.entries(db.tickets)) {
    if (t.guildId === guild.id && t.ownerId === ownerId && !t.closed) {
      const channel = guild.channels.cache.get(channelId);
      if (channel) return channel;
    }
  }
  return null;
}

function ticketEmbed(ticket, owner) {
  const cat = CATEGORIES[ticket.category] || CATEGORIES.other;
  const pri = PRIORITIES[ticket.priority] || PRIORITIES.medium;
  const embed = new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.label} Ticket`)
    .setDescription(
      `Welcome ${owner}!\n\n` +
        'Please explain your issue and a staff member will assist you.\n\n' +
        `**Priority:** ${pri.emoji} ${pri.label}\n` +
        `**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody yet'}\n\n` +
        '🔒 Use the buttons below when you are finished.'
    )
    .setColor(cat.color)
    .setFooter({ text: BRAND_FOOTER });
  if (BRAND_THUMBNAIL) embed.setThumbnail(BRAND_THUMBNAIL);
  return embed;
}

function ticketButtons(ticket) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!ticket.claimedBy),
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );
  return row;
}

async function generateTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );
  const lines = sorted.map((m) => {
    const time = new Date(m.createdTimestamp).toISOString();
    const content = m.content || '[no text content — embed/attachment]';
    return `[${time}] ${m.author.tag}: ${content}`;
  });
  return lines.join('\n') || 'No messages.';
}

async function logTranscript(channel, ticket) {
  if (!LOG_CHANNEL_ID) return;
  const logChannel = channel.guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;

  const transcriptText = await generateTranscript(channel).catch(
    () => 'Failed to generate transcript.'
  );
  const attachment = new AttachmentBuilder(Buffer.from(transcriptText, 'utf8'), {
    name: `${channel.name}-transcript.txt`,
  });

  const embed = new EmbedBuilder()
    .setTitle('🗒️ Ticket Closed')
    .addFields(
      { name: 'Channel', value: `#${channel.name}`, inline: true },
      { name: 'Owner', value: `<@${ticket.ownerId}>`, inline: true },
      { name: 'Category', value: CATEGORIES[ticket.category]?.label || 'Other', inline: true },
      { name: 'Priority', value: PRIORITIES[ticket.priority]?.label || 'Medium', inline: true },
      { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody', inline: true }
    )
    .setColor(0x2f3136)
    .setFooter({ text: BRAND_FOOTER });

  await logChannel.send({ embeds: [embed], files: [attachment] }).catch(() => {});
}

async function sendRatingRequest(ownerId, ticket) {
  if (!ticket.claimedBy) return;
  try {
    const user = await client.users.fetch(ownerId);
    const embed = new EmbedBuilder()
      .setTitle('⭐ How was your support experience?')
      .setDescription('Rate the staff member who helped you.')
      .setColor(0xfee75c)
      .setFooter({ text: BRAND_FOOTER });
    const row = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((n) =>
        new ButtonBuilder()
          .setCustomId(`rate_${n}_${ticket.claimedBy}`)
          .setLabel('⭐'.repeat(n))
          .setStyle(ButtonStyle.Secondary)
      )
    );
    await user.send({ embeds: [embed], components: [row] });
  } catch {
    // DMs closed — skip silently
  }
}

/* =========================
   SLASH COMMAND
========================= */

const ticketCommand = {
  name: 'ticket',
  description: 'Manage the ticket system',
  options: [
    {
      name: 'setup',
      description: 'Create the ticket panel',
      type: 1,
      default_member_permissions: PermissionFlagsBits.ManageChannels.toString(),
    },
    { name: 'close', description: 'Close the current ticket', type: 1 },
    { name: 'delete', description: 'Delete the current ticket', type: 1 },
    {
      name: 'rename',
      description: 'Rename the current ticket',
      type: 1,
      options: [{ name: 'name', description: 'New ticket name', type: 3, required: true }],
    },
    {
      name: 'add',
      description: 'Add a user to the current ticket',
      type: 1,
      options: [{ name: 'user', description: 'User to add', type: 6, required: true }],
    },
    {
      name: 'remove',
      description: 'Remove a user from the current ticket',
      type: 1,
      options: [{ name: 'user', description: 'User to remove', type: 6, required: true }],
    },
    { name: 'claim', description: 'Claim the current ticket', type: 1 },
    {
      name: 'priority',
      description: 'Set the priority of the current ticket',
      type: 1,
      options: [
        {
          name: 'level',
          description: 'Priority level',
          type: 3,
          required: true,
          choices: [
            { name: 'Low', value: 'low' },
            { name: 'Medium', value: 'medium' },
            { name: 'High', value: 'high' },
          ],
        },
      ],
    },
    { name: 'stats', description: 'Show the staff ticket leaderboard', type: 1 },
  ],
};

client.commands.set('ticket', ticketCommand);

/* =========================
   READY
========================= */

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
        { body: [ticketCommand] }
      );
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: [ticketCommand] });
    }
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }

  client.user.setPresence({
    activities: [{ name: 'Managing Tickets', type: 0 }],
    status: 'online',
  });

  // Auto-close inactivity check, every 15 minutes
  setInterval(checkInactiveTickets, 15 * 60 * 1000);
});

async function checkInactiveTickets() {
  const now = Date.now();
  for (const [channelId, ticket] of Object.entries(db.tickets)) {
    if (ticket.closed) continue;
    const guild = client.guilds.cache.get(ticket.guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel) continue;

    const hoursSince = (now - ticket.lastActivity) / (1000 * 60 * 60);

    if (hoursSince >= AUTO_CLOSE_HOURS) {
      await channel
        .send('🔒 Closing this ticket automatically due to inactivity.')
        .catch(() => {});
      await closeTicket(channel, ticket, null);
    } else if (hoursSince >= AUTO_WARN_HOURS && !ticket.warned) {
      ticket.warned = true;
      saveData(db);
      await channel
        .send('⚠️ This ticket has been inactive for a while. It will auto-close if there is no activity.')
        .catch(() => {});
    }
  }
}

async function closeTicket(channel, ticket, closedByUserId) {
  ticket.closed = true;
  if (closedByUserId) ensureStats(closedByUserId).closed += 1;
  saveData(db);

  await logTranscript(channel, ticket);
  await sendRatingRequest(ticket.ownerId, ticket);

  setTimeout(async () => {
    await channel.delete().catch(() => {});
    delete db.tickets[channel.id];
    saveData(db);
  }, 5000);
}

/* =========================
   SLASH COMMANDS
========================= */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ticket') return;

  const subcommand = interaction.options.getSubcommand();
  const ticket = db.tickets[interaction.channel.id];
  const isTicketChannel = !!ticket;

  /* ---- setup ---- */
  if (subcommand === 'setup') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '❌ You need **Manage Channels** or the staff role to use this.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Support Tickets')
      .setDescription(
        'Need help? Open a ticket using one of the buttons below.\n\n' +
          Object.values(CATEGORIES)
            .map((c) => `${c.emoji} **${c.label}**\n${c.desc}`)
            .join('\n\n')
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'Please do not open unnecessary tickets.' });
    if (BRAND_THUMBNAIL) embed.setThumbnail(BRAND_THUMBNAIL);

    const row = new ActionRowBuilder().addComponents(
      Object.entries(CATEGORIES).map(([key, c]) =>
        new ButtonBuilder()
          .setCustomId(`ticket_create_${key}`)
          .setLabel(c.label)
          .setEmoji(c.emoji)
          .setStyle(c.style)
      )
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Ticket panel created!', ephemeral: true });
  }

  /* ---- everything below requires being inside a ticket ---- */
  if (!isTicketChannel) {
    return interaction.reply({
      content: '❌ This command can only be used inside a ticket.',
      ephemeral: true,
    });
  }

  if (subcommand === 'close') {
    await interaction.reply('🔒 This ticket will be closed in **5 seconds**.');
    await closeTicket(interaction.channel, ticket, interaction.user.id);
    return;
  }

  if (subcommand === 'delete') {
    await interaction.reply('🗑️ Deleting ticket...');
    ticket.closed = true;
    saveData(db);
    setTimeout(async () => {
      await interaction.channel.delete().catch(() => {});
      delete db.tickets[interaction.channel.id];
      saveData(db);
    }, 2000);
    return;
  }

  if (subcommand === 'rename') {
    const name = interaction.options.getString('name');
    await interaction.channel.setName(`ticket-${sanitize(name)}`);
    return interaction.reply({ content: `✅ Ticket renamed to **${name}**.` });
  }

  if (subcommand === 'add') {
    const user = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.create(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    return interaction.reply({ content: `✅ Added ${user} to this ticket.` });
  }

  if (subcommand === 'remove') {
    const user = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.delete(user.id);
    return interaction.reply({ content: `✅ Removed ${user} from this ticket.` });
  }

  if (subcommand === 'claim') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });
    }
    if (ticket.claimedBy) {
      return interaction.reply({ content: `❌ Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    }
    ticket.claimedBy = interaction.user.id;
    ensureStats(interaction.user.id).claimed += 1;
    saveData(db);
    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    await interaction.message?.edit?.({ embeds: [ticketEmbed(ticket, owner)], components: [ticketButtons(ticket)] }).catch(() => {});
    return interaction.reply({ content: `✅ ${interaction.user} claimed this ticket.` });
  }

  if (subcommand === 'priority') {
    const level = interaction.options.getString('level');
    ticket.priority = level;
    saveData(db);
    const pri = PRIORITIES[level];
    return interaction.reply({ content: `${pri.emoji} Priority set to **${pri.label}**.` });
  }

  if (subcommand === 'stats') {
    const entries = Object.entries(db.stats)
      .map(([userId, s]) => ({
        userId,
        ...s,
        avgRating: s.ratingCount ? (s.ratingTotal / s.ratingCount).toFixed(1) : '—',
      }))
      .sort((a, b) => b.closed - a.closed)
      .slice(0, 10);

    if (entries.length === 0) {
      return interaction.reply({ content: 'No stats yet.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🏆 Ticket Leaderboard')
      .setDescription(
        entries
          .map(
            (e, i) =>
              `**#${i + 1}** <@${e.userId}> — Closed: ${e.closed} | Claimed: ${e.claimed} | Avg Rating: ${e.avgRating}⭐`
          )
          .join('\n')
      )
      .setColor(0xfee75c)
      .setFooter({ text: BRAND_FOOTER });

    return interaction.reply({ embeds: [embed] });
  }
});

/* =========================
   TICKET BUTTONS
========================= */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId } = interaction;

  /* ---- create ticket (per category) ---- */
  if (customId.startsWith('ticket_create_')) {
    const categoryKey = customId.replace('ticket_create_', '');
    const category = CATEGORIES[categoryKey] || CATEGORIES.other;
    const guild = interaction.guild;

    const existing = findOpenTicket(guild, interaction.user.id);
    if (existing) {
      return interaction.reply({ content: `❌ You already have a ticket: ${existing}`, ephemeral: true });
    }

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
    if (STAFF_ROLE_ID) {
      overwrites.push({
        id: STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${categoryKey}-${sanitize(interaction.user.username)}`,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });

    const ticket = {
      guildId: guild.id,
      ownerId: interaction.user.id,
      category: categoryKey,
      priority: 'medium',
      claimedBy: null,
      closed: false,
      warned: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    db.tickets[ticketChannel.id] = ticket;
    saveData(db);

    await ticketChannel.send({
      content: `${interaction.user}`,
      embeds: [ticketEmbed(ticket, interaction.user)],
      components: [ticketButtons(ticket)],
    });

    return interaction.reply({
      content: `✅ Your ticket has been created: ${ticketChannel}`,
      ephemeral: true,
    });
  }

  /* ---- claim button ---- */
  if (customId === 'ticket_claim') {
    const ticket = db.tickets[interaction.channel.id];
    if (!ticket) return interaction.reply({ content: '❌ This is not a ticket.', ephemeral: true });
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });
    }
    if (ticket.claimedBy) {
      return interaction.reply({ content: `❌ Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    }
    ticket.claimedBy = interaction.user.id;
    ensureStats(interaction.user.id).claimed += 1;
    saveData(db);

    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    await interaction.update({ embeds: [ticketEmbed(ticket, owner)], components: [ticketButtons(ticket)] });
    await interaction.channel.send(`✅ ${interaction.user} claimed this ticket.`);
    return;
  }

  /* ---- close button ---- */
  if (customId === 'ticket_close') {
    const ticket = db.tickets[interaction.channel.id];
    if (!ticket) return interaction.reply({ content: '❌ This is not a ticket.', ephemeral: true });

    await interaction.reply('🔒 Ticket closed. Closing in **5 seconds**...');
    await closeTicket(interaction.channel, ticket, interaction.user.id);
    return;
  }

  /* ---- rating buttons (sent via DM) ---- */
  if (customId.startsWith('rate_')) {
    const [, starsStr, staffId] = customId.split('_');
    const stars = Number(starsStr);
    const stats = ensureStats(staffId);
    stats.ratingTotal += stars;
    stats.ratingCount += 1;
    saveData(db);

    await interaction.update({
      content: `Thanks for your feedback! You rated: ${'⭐'.repeat(stars)}`,
      embeds: [],
      components: [],
    });
  }
});

/* =========================
   ACTIVITY TRACKING (for auto-close)
========================= */

client.on('messageCreate', (message) => {
  const ticket = db.tickets[message.channel.id];
  if (!ticket || ticket.closed) return;
  ticket.lastActivity = Date.now();
  ticket.warned = false;
  saveData(db);
});

/* =========================
   LOGIN
========================= */

client.login(process.env.DISCORD_TOKEN);
