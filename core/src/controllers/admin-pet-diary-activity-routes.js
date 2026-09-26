const { getAuthorizedAccountId, requireConnectedAccount } = require('./admin-activity-route-helpers');

const PET_DIARY_ACTIONS = [
  'initialize', 'feed', 'draw', 'story', 'seeds', 'refreshCharm', 'equipCharm',
  'battle', 'openTreasure', 'compensation', 'exchange', 'claimDog',
  'markStories', 'skipBattle', 'solar',
];

function registerAdminPetDiaryRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const context = { getAccountIdFromRequest, canAccessAccount };
  const guard = (req, res, label) => {
    const accountId = getAuthorizedAccountId(req, res, context);
    if (!accountId) return null;
    if (!requireConnectedAccount(res, provider, accountId, `${label}: 账号未运行`)) return null;
    return accountId;
  };

  app.get('/api/activity/pet-diary', async (req, res) => {
    const id = guard(req, res, '获取萌宠日记失败'); if (!id) return;
    try { res.json({ ok: true, activity: await provider.getPetDiary(id) }); } catch (err) { sendProviderError(res, err); }
  });

  app.get('/api/activity/pet-diary/records', async (req, res) => {
    const id = guard(req, res, '获取萌宠记录失败'); if (!id) return;
    try { res.json({ ok: true, records: await provider.getPetDiaryRecords(id, req.query.kind) }); } catch (err) { sendProviderError(res, err); }
  });

  app.get('/api/activity/pet-diary/friend', async (req, res) => {
    const id = guard(req, res, '获取好友萌宠信息失败'); if (!id) return;
    try { res.json({ ok: true, friend: await provider.getPetDiaryFriend(id, req.query.gid) }); } catch (err) { sendProviderError(res, err); }
  });

  app.post('/api/activity/pet-diary/operate', async (req, res) => {
    const action = String((req.body && req.body.action) || '');
    if (!PET_DIARY_ACTIONS.includes(action)) return res.json({ ok: false, error: '未知操作' });
    const id = guard(req, res, '萌宠操作失败'); if (!id) return;
    try {
      const result = await provider.operatePetDiary(id, action, req.body && req.body.params);
      res.json({ ok: true, ...result });
    } catch (err) { sendProviderError(res, err); }
  });
}

module.exports = { registerAdminPetDiaryRoutes };
