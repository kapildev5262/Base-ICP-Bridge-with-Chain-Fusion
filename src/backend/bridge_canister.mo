import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Hash "mo:base/Hash";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Option "mo:base/Option";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Int "mo:base/Int";

actor BridgeCanister {
    type TokenInterface = actor {
        transfer : shared (to : Principal, amount : Nat) -> async Result.Result<(), Text>;
        transferFrom : shared (from : Principal, to : Principal, amount : Nat) -> async Result.Result<(), Text>;
        balanceOf : shared (account : Principal) -> async Nat;
    };

    type TransferStatus = {
        completed : Bool;
        timestamp : Nat64;
    };

    type TransferRecord = {
        id : Text;
        token : Principal;
        amount : Nat;
        sender : Principal;
        recipient : Text;
        timestamp : Nat64;
        completed : Bool;
        signature : ?Blob;
    };

    private stable var owner : Principal = Principal.fromText("ll625-bdz2k-ezv67-rdgqt-btnat-7fubl-ggtpa-ze7ra-5t735-eu7tn-vqe");
    private stable var ethValidators : [Principal] = [];
    private stable var requiredSignatures : Nat = 0;
    
    private let transfers = HashMap.HashMap<Text, TransferRecord>(0, Text.equal, Text.hash);
    private stable var transfersEntries : [(Text, TransferRecord)] = [];
    
    private stable var minimumCycles : Nat = 1_000_000_000_000;
    
    private stable var tokenPairings : [(Principal, Text)] = [];
    
    system func preupgrade() {
        transfersEntries := Iter.toArray(transfers.entries());
    };
    
    system func postupgrade() {
        for ((id, record) in transfersEntries.vals()) {
            transfers.put(id, record);
        };
        transfersEntries := [];
    };
    
    private func isOwner(caller : Principal) : Bool {
        return Principal.equal(owner, caller);
    };
    
    private func isValidator(caller : Principal) : Bool {
        return Array.find<Principal>(ethValidators, func(p) { Principal.equal(p, caller) }) != null;
    };
    
    private func generateTransferId(sender : Principal, token : Principal, amount : Nat, timestamp : Nat64) : Text {
        return Principal.toText(sender) # "-" # Principal.toText(token) # "-" # Nat.toText(amount) # "-" # Nat64.toText(timestamp);
    };
    
    public shared(msg) func lockTokens(request : { token : Principal; amount : Nat; recipient : Text }) : async { txId : Text } {
        let sender = msg.caller;
        let timestamp = Nat64.fromNat(Int.abs(Time.now()));
        let txId = generateTransferId(sender, request.token, request.amount, timestamp);
        
        let record : TransferRecord = {
            id = txId;
            token = request.token;
            amount = request.amount;
            sender = sender;
            recipient = request.recipient;
            timestamp = timestamp;
            completed = false;
            signature = null;
        };
        
        let tokenActor : TokenInterface = actor(Principal.toText(request.token));
        let transferResult = await tokenActor.transferFrom(sender, Principal.fromActor(BridgeCanister), request.amount);
        
        switch (transferResult) {
            case (#ok()) {
                transfers.put(txId, record);
                return { txId = txId };
            };
            case (#err(message)) {
                throw Error.reject("Token transfer failed: " # message);
            };
        };
    };
    
    public query func getTransferStatus(txId : Text) : async ?TransferStatus {
        switch (transfers.get(txId)) {
            case (?record) {
                return ?{
                    completed = record.completed;
                    timestamp = record.timestamp;
                };
            };
            case (null) {
                return null;
            };
        };
    };
    
    public shared(msg) func processBaseToICPTransfer(
        ethTxHash : Text,
        tokenCanister : Principal,
        recipient : Principal,
        amount : Nat,
        signatures : [Blob]
    ) : async Result.Result<(), Text> {
        if (not isValidator(msg.caller)) {
            return #err("Unauthorized");
        };
        
        if (signatures.size() < requiredSignatures) {
            return #err("Insufficient signatures");
        };

        switch (transfers.get(ethTxHash)) {
            case (?existing) {
                if (existing.completed) {
                    return #ok();
                };
            };
            case (_) {};
        };
        
        let tokenActor : TokenInterface = actor(Principal.toText(tokenCanister));
        let transferResult = await tokenActor.transfer(recipient, amount);
        
        switch (transferResult) {
            case (#ok()) {
                let timestamp = Nat64.fromNat(Int.abs(Time.now()));
                let txId = ethTxHash;
                
                let record : TransferRecord = {
                    id = txId;
                    token = tokenCanister;
                    amount = amount;
                    sender = msg.caller;
                    recipient = Principal.toText(recipient);
                    timestamp = timestamp;
                    completed = true;
                    signature = ?signatures[0]; 
                };
                
                transfers.put(txId, record);
                return #ok();
            };
            case (#err(message)) {
                return #err("Token transfer failed: " # message);
            };
        };
    };
    
    public query func getPendingTransfers() : async [TransferRecord] {
        let pendingTransfers = Buffer.Buffer<TransferRecord>(0);
        
        for ((_, record) in transfers.entries()) {
            if (not record.completed) {
                pendingTransfers.add(record);
            };
        };
        
        return Buffer.toArray(pendingTransfers);
    };
    
    public shared(msg) func markTransferProcessed(txId : Text) : async Result.Result<(), Text> {
        if (not isValidator(msg.caller)) {
            return #err("Unauthorized");
        };
        
        switch (transfers.get(txId)) {
            case (?record) {
                let updatedRecord = {
                    id = record.id;
                    token = record.token;
                    amount = record.amount;
                    sender = record.sender;
                    recipient = record.recipient;
                    timestamp = record.timestamp;
                    completed = true;
                    signature = record.signature;
                };
                
                transfers.put(txId, updatedRecord);
                return #ok();
            };
            case (null) {
                return #err("Transfer not found");
            };
        };
    };

    public func getTokenBalance(tokenId: Principal, user: Principal) : async Nat {
        let tokenActor : TokenInterface = actor(Principal.toText(tokenId));
        let balance = await tokenActor.balanceOf(user);
        return balance;
    };
    
    public shared(msg) func setValidators(validators : [Principal]) : async Result.Result<(), Text> {
        if (not isOwner(msg.caller)) {
            return #err("Unauthorized");
        };
        
        ethValidators := validators;
        return #ok();
    };
    
    public shared(msg) func setRequiredSignatures(count : Nat) : async Result.Result<(), Text> {
        if (not isOwner(msg.caller)) {
            return #err("Unauthorized");
        };
        
        if (count > ethValidators.size()) {
            return #err("Required signatures cannot exceed validator count");
        };
        
        requiredSignatures := count;
        return #ok();
    };
    
    public shared(msg) func addTokenPairing(icpToken : Principal, ethToken : Text) : async Result.Result<(), Text> {
        if (not isOwner(msg.caller)) {
            return #err("Unauthorized");
        };
        
        tokenPairings := Array.append(tokenPairings, [(icpToken, ethToken)]);
        return #ok();
    };
    
    public func acceptCycles() : async () {
        let available = Cycles.available();
        let accepted = Cycles.accept(available);
    };
    
    public query func getCycleBalance() : async Nat {
        return Cycles.balance();
    };

    public shared(msg) func resetCanister() : async Result.Result<(), Text> {
        if (not isOwner(msg.caller)) {
            return #err("Unauthorized");
        };
        
        ethValidators := [];
        requiredSignatures := 0;
        tokenPairings := [];
        
        let keys = Buffer.Buffer<Text>(0);
        for ((key, _) in transfers.entries()) {
            keys.add(key);
        };
        
        for (key in keys.vals()) {
            ignore transfers.remove(key);
        };
        
        transfersEntries := [];
        
        return #ok();
    };
};