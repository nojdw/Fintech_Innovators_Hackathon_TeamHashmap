from ib_insync import IB

def get_ib_connection(port=4001, client_id=1):
    """Connect to IB Gateway"""
    ib = IB()
    ib.connect('127.0.0.1', port, clientId=client_id, readonly=True)
    return ib

def get_portfolio(ib: IB) -> list[dict]:
    portfolio = ib.portfolio()
    return [
        {
            "symbol":         item.contract.symbol,
            "sec_type":       item.contract.secType,
            "position":       item.position,
            "market_price":   item.marketPrice,
            "market_value":   item.marketValue,
            "avg_cost":       item.averageCost,
            "unrealized_pnl": item.unrealizedPNL,
            "realized_pnl":   item.realizedPNL,
            "currency":       item.contract.currency,
        }
        for item in portfolio
    ]

def get_account_summary(ib: IB) -> dict:
    summary = ib.accountSummary()
    keys = {"NetLiquidation", "TotalCashValue", "UnrealizedPnL",
            "RealizedPnL", "GrossPositionValue"}
    return {
        item.tag: item.value
        for item in summary
        if item.tag in keys
    }
# New comment