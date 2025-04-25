import Principal "mo:base/Principal";
import Result "mo:base/Result";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";

actor TokenCanister {
  private var balances = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
  private stable var balancesEntries : [(Principal, Nat)] = [];
  
  public shared(msg) func mint(to: Principal, amount: Nat) : async Result.Result<(), Text> {
    let currentBalance = switch (balances.get(to)) {
      case null { 0 };
      case (?value) { value };
    };
    balances.put(to, currentBalance + amount);
    #ok()
  };
  
  public shared(msg) func transfer(to: Principal, amount: Nat) : async Result.Result<(), Text> {
    let sender = msg.caller;
    switch (balances.get(sender)) {
      case null { return #err("Insufficient balance"); };
      case (?senderBalance) {
        if (senderBalance < amount) {
          return #err("Insufficient balance");
        };
        balances.put(sender, senderBalance - amount);
        let recipientBalance = switch (balances.get(to)) {
          case null { 0 };
          case (?value) { value };
        };
        balances.put(to, recipientBalance + amount);
        #ok()
      };
    }
  };
  
  public shared(msg) func transferFrom(from: Principal, to: Principal, amount: Nat) : async Result.Result<(), Text> {
    switch (balances.get(from)) {
      case null { return #err("Insufficient balance"); };
      case (?fromBalance) {
        if (fromBalance < amount) {
          return #err("Insufficient balance");
        };
        balances.put(from, fromBalance - amount);
        let toBalance = switch (balances.get(to)) {
          case null { 0 };
          case (?value) { value };
        };
        balances.put(to, toBalance + amount);
        #ok()
      };
    }
  };
  
  public query func balanceOf(owner: Principal) : async Nat {
    switch (balances.get(owner)) {
      case null { 0 };
      case (?value) { value };
    }
  };
  
  system func preupgrade() {
    balancesEntries := Iter.toArray(balances.entries());
  };
  
  system func postupgrade() {
    balances := HashMap.fromIter<Principal, Nat>(
      balancesEntries.vals(), 10, Principal.equal, Principal.hash);
    balancesEntries := [];
  };

  // Add to TokenCanister
  private let owner : Principal = Principal.fromText("ll625-bdz2k-ezv67-rdgqt-btnat-7fubl-ggtpa-ze7ra-5t735-eu7tn-vqe");

  // Check if caller is the owner
  private func isOwner(caller : Principal) : Bool {
  return Principal.equal(caller, owner);
  };

  // Reset function for testing
  public shared(msg) func reset() : async Result.Result<(), Text> {
    if (not isOwner(msg.caller)) {
      return #err("Unauthorized");
    };
  
    balances := HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    return #ok();
  };
}