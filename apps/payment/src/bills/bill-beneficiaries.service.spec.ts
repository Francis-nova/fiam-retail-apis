import { NotFoundException } from '@nestjs/common';
import { BillBeneficiariesService } from './bill-beneficiaries.service';
import type { BillBeneficiary } from './entities/bill-beneficiary.entity';

function make(found: Partial<BillBeneficiary> | null) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(found),
    save: jest.fn((b: BillBeneficiary) => Promise.resolve(b)),
    update: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
  };
  return {
    repo,
    service: new BillBeneficiariesService(repo as never),
  };
}

describe('BillBeneficiariesService', () => {
  it('only finds beneficiaries owned by the caller and not dismissed', async () => {
    const { service, repo } = make(null);
    await expect(service.rename('u1', 'id1', 'Mum')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.dismiss('u1', 'id1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'id1', userId: 'u1', dismissed: false },
    });
  });

  it('trims the nickname, and a blank one clears it', async () => {
    const { service } = make({ id: 'id1', nickname: null });
    expect((await service.rename('u1', 'id1', '  Mum  ')).nickname).toBe('Mum');
    const again = make({ id: 'id1', nickname: 'Mum' });
    expect(
      (await again.service.rename('u1', 'id1', '   ')).nickname,
    ).toBeNull();
  });

  it('dismissing flags the row and drops the nickname instead of deleting it', async () => {
    const { service, repo } = make({ id: 'id1', nickname: 'Mum' });
    await service.dismiss('u1', 'id1');
    expect(repo.update).toHaveBeenCalledWith('id1', {
      dismissed: true,
      nickname: null,
    });
  });

  it('records a success with the biller type derived from the category', async () => {
    const { service, repo } = make(null);
    await service.recordSuccess(
      'u1',
      {
        category: 'Cable TV',
        billerId: 'dstv',
        billerName: 'DSTV',
        division: 'C',
        productId: '399',
        paymentItem: 'p',
        paymentItemName: 'Compact',
        customerId: '1234567890',
        token: null,
      },
      '9000.0000',
    );
    const [sql, params] = repo.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).not.toMatch(/"nickname"\s*=/);
    expect(sql).not.toMatch(/"dismissed"\s*=/);
    expect(params[1]).toBe('CABLE_TV');
  });
});
