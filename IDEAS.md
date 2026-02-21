# Ideas for improvement

- in auth, just return token, consolidate paths
- don't duplicate --tenant-id and parse --xeroTenantId after -- instead (all in one place)


Required flow, for later:

The flow overall that we want (which is most common for me is):
- list non-reconciled bank transactions (we have already)
- list bills (invoices payable) that are not 'paid' - how?
- pick one non-reconciled transaction in bank feed (oldest one)
- create a corresponding bill
- upload attachment to that bill (pdf)
- currently api has no way to reconcile transaction, this is ok, user can do it manually for now
