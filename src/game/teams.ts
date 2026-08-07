import type { GameMode, Player, Room, Team, TeamAssignMode, TeamSize } from './types'

export function isTeamMode(mode: GameMode | null | undefined): boolean {
  return mode === 'team'
}

/** Room sizes that work with a given team size (5p + size-2 gets a bot at start). */
export function teamRoomSizes(teamSize: TeamSize): number[] {
  if (teamSize === 3) return [3, 6]
  return [2, 4, 5, 6, 8]
}

export function defaultTeamSize(maxPlayers: number): TeamSize {
  return maxPlayers % 3 === 0 && maxPlayers !== 6 ? 3 : 2
}

export function teamOfPlayer(room: Room, playerId: string): Team | null {
  return room.teams?.find((team) => team.memberIds.includes(playerId)) ?? null
}

/** True when both ids are on the same team (Team mode only). */
export function areTeammates(room: Room, a: string, b: string): boolean {
  if (a === b) return true
  if (!isTeamMode(room.gameMode) || !room.teams?.length) return false
  return room.teams.some(
    (team) => team.memberIds.includes(a) && team.memberIds.includes(b),
  )
}

export function winningTeam(room: Room): Team | null {
  if (!room.teams?.length || !room.game) return null
  if (room.winningTeamId) {
    return room.teams.find((team) => team.id === room.winningTeamId) ?? null
  }
  return (
    room.teams.find((team) =>
      team.memberIds.every((id) => room.game!.winnerIds.includes(id)),
    ) ?? null
  )
}

/** Login-capable humans on the winning team (bots skipped by caller). */
export function winningTeamMemberIds(room: Room): string[] {
  const team = winningTeam(room)
  if (!team) return []
  return team.memberIds.filter((id) => {
    const player = [...room.players, ...(room.departedPlayers ?? [])].find(
      (candidate) => candidate.id === id,
    )
    return player && !player.isBot
  })
}

export function buildRandomTeams(
  players: Player[],
  teamSize: TeamSize,
): Team[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5)
  const teams: Team[] = []
  for (let index = 0; index < shuffled.length; index += teamSize) {
    const slice = shuffled.slice(index, index + teamSize)
    if (slice.length === 0) continue
    teams.push({
      id: crypto.randomUUID(),
      memberIds: slice.map((player) => player.id),
    })
  }
  return teams
}

export function buildSequentialTeams(
  players: Player[],
  teamSize: TeamSize,
): Team[] {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)
  const teams: Team[] = []
  for (let index = 0; index < sorted.length; index += teamSize) {
    const slice = sorted.slice(index, index + teamSize)
    if (slice.length === 0) continue
    teams.push({
      id: crypto.randomUUID(),
      memberIds: slice.map((player) => player.id),
    })
  }
  return teams
}

export function validateTeamAssignment(
  players: Player[],
  teams: Team[],
  teamSize: TeamSize,
): string | null {
  if (teams.length === 0) return 'Teams are not set.'
  const seen = new Set<string>()
  for (const team of teams) {
    if (team.memberIds.length === 0) return 'Empty team.'
    if (team.memberIds.length > teamSize) {
      return `Teams can have at most ${teamSize} members.`
    }
    for (const id of team.memberIds) {
      if (seen.has(id)) return 'Player listed on two teams.'
      seen.add(id)
      if (!players.some((player) => player.id === id)) {
        return 'Team has unknown player.'
      }
    }
  }
  for (const player of players) {
    if (!seen.has(player.id)) return `${player.name} is not on a team.`
  }
  const incomplete = teams.filter((team) => team.memberIds.length < teamSize)
  if (incomplete.length > 1) {
    return 'Too many incomplete teams.'
  }
  if (
    incomplete.length === 1 &&
    incomplete[0].memberIds.length !== teamSize - 1 &&
    incomplete[0].memberIds.length !== 1
  ) {
    // Allow one short team only when leftover bot fill will complete a pair.
    if (!(teamSize === 2 && incomplete[0].memberIds.length === 1)) {
      return 'Incomplete team size is invalid.'
    }
  }
  return null
}

export function normalizeTeamAssign(
  value: TeamAssignMode | null | undefined,
): TeamAssignMode {
  return value === 'manual' ? 'manual' : 'random'
}

export function normalizeTeamSize(
  value: number | null | undefined,
  maxPlayers: number,
): TeamSize {
  if (value === 3 && teamRoomSizes(3).includes(maxPlayers)) return 3
  return 2
}
