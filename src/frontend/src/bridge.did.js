// src/frontend/src/bridge.did.js
export const idlFactory = ({ IDL }) => {
    return IDL.Service({
      'lockTokens': IDL.Func([
        IDL.Record({
          'token': IDL.Principal,
          'amount': IDL.Nat,
          'recipient': IDL.Text
        })
      ], [
        IDL.Record({
          'txId': IDL.Text
        })
      ], []),
      'getTransferStatus': IDL.Func([
        IDL.Text
      ], [
        IDL.Record({
          'completed': IDL.Bool,
          'timestamp': IDL.Nat64
        })
      ], ['query']),
      'processBaseToICPTransfer': IDL.Func([
        IDL.Text,
        IDL.Principal,
        IDL.Principal,
        IDL.Nat,
        IDL.Vec(IDL.Vec(IDL.Nat8))
      ], [
        IDL.Variant({
          'ok': IDL.Tuple(),
          'err': IDL.Text
        })
      ], [])
    });
  };