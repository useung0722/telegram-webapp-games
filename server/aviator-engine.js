const { getWallet, saveWallets, formatKoreanNumber, checkAndUnlockTitles } = require('./wallet-manager');

class WebAviatorEngine {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.flights = {};
    this.flightCounter = 1;
    this.TICK_INTERVAL_MS = 100; // 0.1초 정밀 틱
  }

  getCurrentFlight(roomId = 'global') {
    return this.flights[roomId] || null;
  }

  createFlight(roomId = 'global') {
    if (this.flights[roomId] && this.flights[roomId].state !== 'crashed') {
      return this.flights[roomId];
    }

    // 크래시 배수 결정 (하우스 엣지 3%, 지수분포)
    const houseEdge = 0.03;
    const rand = Math.random();
    let crashMultiplier;
    if (rand < houseEdge) {
      crashMultiplier = 1.00; // 즉시 폭발
    } else {
      crashMultiplier = Math.floor((0.97 / (1 - rand)) * 100) / 100;
      crashMultiplier = Math.min(100.0, Math.max(1.01, crashMultiplier));
    }

    const flight = {
      roomId,
      flightNo: this.flightCounter++,
      state: 'boarding', // 'boarding' | 'flying' | 'crashed'
      multiplier: 1.00,
      crashMultiplier,
      startTime: Date.now() + 15000, // 15초 탑승 시간
      bets: {}, // userId -> { amount, isAllIn, cashedOut: false, cashOutMultiplier: 0, payout: 0 }
      elapsedSec: 0
    };

    this.flights[roomId] = flight;
    this.broadcast('aviator_boarding', this.sanitizeFlight(flight));

    flight.timer = setTimeout(() => {
      this.startFlight(roomId);
    }, 15000);

    return flight;
  }

  placeBet(roomId, user, amount, isAllIn = false) {
    const flight = this.flights[roomId];
    if (!flight || flight.state !== 'boarding') {
      return { ok: false, error: '현재 탑승 수속 중인 비행기가 없습니다.' };
    }

    const wallet = getWallet(user.id, user.name);
    let betAmount = Math.floor(amount);
    if (isAllIn) {
      betAmount = wallet.points;
    }

    if (betAmount < 1000) {
      return { ok: false, error: '최소 탑승 금액은 1,000 P 입니다.' };
    }
    if (wallet.points < betAmount) {
      return { ok: false, error: `잔액이 부족합니다. (현재: ${formatKoreanNumber(wallet.points)} P)` };
    }

    wallet.points -= betAmount;
    if (wallet.points === 0) wallet.bankruptHit = true;
    saveWallets();

    flight.bets[user.id] = {
      userId: user.id,
      name: user.name,
      amount: betAmount,
      isAllIn,
      cashedOut: false,
      cashOutMultiplier: 0,
      payout: 0
    };

    this.broadcast('aviator_bet_placed', {
      roomId,
      flightNo: flight.flightNo,
      bet: flight.bets[user.id],
      userWallet: { points: wallet.points, formatted: formatKoreanNumber(wallet.points) }
    });

    return { ok: true, bet: flight.bets[user.id], currentPoints: wallet.points };
  }

  cashOut(roomId, user) {
    const flight = this.flights[roomId];
    if (!flight || flight.state !== 'flying') {
      return { ok: false, error: '비행 중인 상태가 아닙니다.' };
    }

    const bet = flight.bets[user.id];
    if (!bet) {
      return { ok: false, error: '배팅 내역이 없습니다.' };
    }
    if (bet.cashedOut) {
      return { ok: false, error: '이미 탈출하셨습니다.' };
    }

    bet.cashedOut = true;
    bet.cashOutMultiplier = flight.multiplier;
    const payout = Math.floor(bet.amount * flight.multiplier);
    const profit = payout - bet.amount;
    bet.payout = payout;

    const wallet = getWallet(user.id, user.name);
    wallet.points += payout;
    wallet.wins = (wallet.wins || 0) + 1;
    if (flight.multiplier > (wallet.maxOdds || 0)) wallet.maxOdds = flight.multiplier;
    if (profit > (wallet.maxProfit || 0)) wallet.maxProfit = profit;
    if (bet.isAllIn) wallet.allInWon = true;

    checkAndUnlockTitles(wallet);
    saveWallets();

    this.broadcast('aviator_cashed_out', {
      roomId,
      flightNo: flight.flightNo,
      userId: user.id,
      name: user.name,
      multiplier: flight.multiplier,
      payout,
      profit,
      formattedPayout: formatKoreanNumber(payout),
      currentPoints: wallet.points,
      formattedPoints: formatKoreanNumber(wallet.points)
    });

    return { ok: true, multiplier: flight.multiplier, payout, profit };
  }

  startFlight(roomId) {
    const flight = this.flights[roomId];
    if (!flight || flight.state !== 'boarding') return;

    if (flight.timer) clearTimeout(flight.timer);
    flight.state = 'flying';
    flight.flightStartTime = Date.now();
    this.broadcast('aviator_takeoff', this.sanitizeFlight(flight));

    flight.interval = setInterval(() => {
      flight.elapsedSec += (this.TICK_INTERVAL_MS / 1000);
      
      // 비행기 상승 곡선: t^1.5 지수 가속
      const growth = 1.0 + Math.pow(flight.elapsedSec, 1.45) * 0.08;
      flight.multiplier = Math.round(growth * 100) / 100;

      this.broadcast('aviator_tick', {
        roomId,
        flightNo: flight.flightNo,
        multiplier: flight.multiplier,
        elapsedSec: Math.round(flight.elapsedSec * 10) / 10
      });

      // 폭발 검증
      if (flight.multiplier >= flight.crashMultiplier) {
        clearInterval(flight.interval);
        this.crashFlight(roomId, flight);
      }
    }, this.TICK_INTERVAL_MS);
  }

  crashFlight(roomId, flight) {
    flight.state = 'crashed';
    flight.multiplier = flight.crashMultiplier;

    // 미탈출 배팅 정산 (패배 처리)
    const crashedUsers = [];
    for (const [userId, bet] of Object.entries(flight.bets)) {
      if (!bet.cashedOut) {
        crashedUsers.push({
          userId,
          name: bet.name,
          lostAmount: bet.amount,
          formattedLost: formatKoreanNumber(bet.amount)
        });
      }
    }

    this.broadcast('aviator_crashed', {
      roomId,
      flightNo: flight.flightNo,
      finalMultiplier: flight.crashMultiplier,
      crashedUsers
    });

    // 10초 후 다음 비행편 자동 대기 오픈
    setTimeout(() => {
      this.createFlight(roomId);
    }, 10000);
  }

  sanitizeFlight(flight) {
    return {
      roomId: flight.roomId,
      flightNo: flight.flightNo,
      state: flight.state,
      multiplier: flight.multiplier,
      startTime: flight.startTime,
      betsCount: Object.keys(flight.bets).length
    };
  }
}

module.exports = {
  WebAviatorEngine
};

