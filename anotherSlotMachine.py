# Imports:
import os, random, time 
import gamblingShop as GShop

# Symbols used in the slot machine:
symbols = ["🍒", "🍋", "🍊", "🍉", "💸", "💰", "🍀", "⚡", "🍑"]




# Main slot machine code:
def slotMachine(credits):
    catchphrase = ["a new amazing offer!", "crazy deals!", "rock-bottom prices!", "the most valuable purchase you'll ever make!"]
    credits = int(credits)
    print(f'''
    
    Gambling.com
    -Slot Machine-
    credits: {credits}
    _____________
    |   |   |   |
    |💸 |🍊 |🍑 |
    |___|___|___|
''')
    amount = int(input("Enter amount of credits to be used: "))

    if amount > credits:
        os.system('cls')
        print("You do not have enough credits")
        print(f"Credits: {credits}")
        print("However, you can buy more credits!")
        gamblingShop = input(f"Enter the shop for {random.choice(catchphrase)} (y/n): ").lower()
        if gamblingShop == "y":
            GShop.Shop() # Runs the 'Shop()' function from gamblingShop.py
        elif gamblingShop == "n":
            print("How could you miss out on this one-in-a-lifetime chance!")
            print("Don't worry, you can also win more credits by playing the slot machine")
            exit() # Maybe set something to go back into the slot machine
        else:
            print("Sorry, I didn't get that")
            exit() # Set a loop here, maybe

    for i in range (amount):
        credits -= 1
        # Slot machine runs here
        os.system('cls')
        for p in range(7): # Number of spins till it lands on a final result
            os.system('cls')
            reel1 = random.choice(symbols)
            reel2 = random.choice(symbols)
            reel3 = random.choice(symbols)
            print(f'''
            Gambling.com
            -Slot Machine-
            credits: {credits}
            _____________
            |   |   |   |
            |{reel1} |{reel2} |{reel3} |
            |___|___|___|   

        ''')
            time.sleep(0.1 + p*0.05) # Slows down the spins gradually
        winnings = 0
        if reel1 == reel2 == reel3:
            if reel1 == "🍒":
                winnings = 50
            elif reel1 == "🍋":
                winnings = 0.5
            elif reel1 == "🍊":
                winnings = 5
            elif reel1 == "🍉":
                winnings = 10
            elif reel1 == "💸":
                winnings = 100
            elif reel1 == "💰":
                winnings = 200
            elif reel1 == "🍀":
                winnings = 500
            elif reel1 == "⚡":
                winnings = credits * 2
            elif reel1 == "🍑":
                winnings = 100
        elif reel1 == reel2 or reel2 == reel3 or reel1 == reel3:
            winnings = 2

        print(f"Congratulations! You won {winnings} credits!")
        credits += winnings
        print(f"You now have {credits} credits!") # This is where you end up if you win 3 in a row
        winnings = 0
        time.sleep(2)
        
    return credits



