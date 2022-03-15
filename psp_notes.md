## Steps required befor PSP flow can be started:

1. Deploy AirnodeProtocol contract
1. Deploy AccessControlRegistry contract
1. Deploy DapiServer contract
1. ~~Deploy AllocatorWithManager contract~~
1. **Do we need any whitelisting on DapiServer contract for readers or others?** It seems that reader == address(0) was
   kept so Airkeeper should still be able to read without the need to whitelist. But now that I think about it the
   condition function is the one reading the value therefore Airkeeper might not even need to read the current data
   point value in order to determine if update is needed.
1. Derive sponsor wallet, fund it and call AirnodeProtocol.setPspSponsorshipStatus()
1. Call AirnodeProtocol.storeTemplate?
1. Call AirnodeProtocol.storeSubscription?
1. Call DapiServer.registerBeaconUpdateSubscription() **relayer===airnodeAddress?** It seems by the explanation here
   around 3:43 https://drive.google.com/file/d/14BaWqZojFCy7ZQrnp8V2sxDP-mGyLdGV/view that Airkeeper will no need to use
   relayer in any way.
1. Call AllocatorWithManager.setSlot() **where do I get slotIndex value from?**

## PSP flow

1. The Airnode fetches their active subscription IDs from its Allocators

Airkeeper will probably need an object with the AllocatorWithManager contract addresses plus the chainId (see
authorizers in config.json master branch)

This step means calling AllocatorWithManager.airnodeToSlotIndexToSlot(airnodeAddress). This will return a mappaing of
index to Slot object where each object represents a susbscription.

2. The Airnode fetches the subscription details from the chain if they have been stored (by calling
   `storeSubscription()`), or the subscription could be hardcoded at the node configuration. It also fetches the
   referenced template. It verifies the integrity of the template and the subscription details by comparing the hash of
   the details to the ID.

Similarly to call-api.ts in Airkeeper, subscription details will need to be hardcoded in the config or fetched from the
chain by calling AirnodeProtocol.subscriptions(subscriptionId). Same for templates.

3. The Airnode checks `AirnodeProtocol.sponsorToSubscriptionIdToPspSponsorshipStatus()` to verify the `sponsor`s
   specified in the subscription details

In previous RRP protocol v0 this mapping was used onchain to verify sponsorship status while making a request but now
this check will only be performed off-chain, correct? There is a mention of this in the
[DapiServer.registerBeaconUpdateSubscription()](https://github.com/api3dao/airnode/blob/v1-protocol/packages/airnode-protocol-v1/contracts/dapis/DapiServer.sol#L250-L252)
function comments but no use of the mapping on-chain.

4. The Airnode checks its Authorizers to verify that the `requester`s specified in the subscription details are
   authorized

Subscription details will set the `requester` to the DapiServer contract address.

It sounds like we could keep the 2 config files approach currently being implemented in Airkeeper (but tbh I would
really like to just update current config.json with all new fields required by PSP).

See for reference:
https://github.com/api3dao/airnode/blob/v1-protocol/packages/airnode-node/src/evm/authorization/authorization-fetching.ts#L45

5. The Airnode makes the API call specified by the template and the additional parameters

Probably current
[call-api-ts](https://github.com/api3dao/airkeeper/blob/main/src/api/call-api.ts) in
Airkeeper can be re-used for this step.

6. Using the response from the API, the Airnode checks if the condition specified in the `conditions` field of the
   subscription is met (in most cases, by making a static call to a function)

I'm confused about
[this](https://github.com/api3dao/airnode/blob/v1-protocol/packages/airnode-protocol-v1/contracts/dapis/DapiServer.sol#L20-L23)
step because this comment says that it is not needed for beacon updates.

If I still need to check the condition in Airkeeper then I guess I need to get the percentage value used when calling
DapiServer.registerBeaconUpdateSubscription() and lastly call DapiServer.conditionPspBeaconUpdate(). The percentage
value should be in the config but also in the subscription details from step 2.

7. If the condition is met, the Airnode fulfills the subscription by calling the specified function using the sponsor
   wallet

   This step means that Airkeeper will need to derive the sponsor wallet, use the airnode wallet to sign the message (or
   should we use relayer here?) and call DapiServer.fulfillPspBeaconUpdate().

## Other questions:

1. Should Airkeeper run the new coordinator lambda function every minute like current lamdba function?
1. What was the requirement for having the need of more than one lambda function and a coordinator function? Answer in
   51:35 https://drive.google.com/file/d/14BaWqZojFCy7ZQrnp8V2sxDP-mGyLdGV/view
1. How to test this??? Should I try adding these new contracts to airnode-operations package and set everything there so
   I can run my tests locally?
1. Operations repo will probably generate all the data for the template and subscriptions but does it have to actually
   store it onchain?
