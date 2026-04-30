# Imports:
import random, time, os
import corridors as C

def Shop():
    print("You have entered the gambling shop!") # Need to add shop code here
    options = input('''You have 2 options to get more credits:
    1. Try your luck in the confusing corridors
    OR
    2. Negotiate with the loan shark
    3. Run for your life and break the addiction
    (1/2/3) >>> ''')
    while True:
        if int(options) == 1:
            creditsGained = C.corridors()
            if creditsGained == 0:
                print("You didn't get anything")
                time.sleep(2)
                return True

            else:
                print(f"You got {creditsGained} credits")
                with open(os.path.join(os.path.dirname(__file__), "global.txt"), "r") as f:
                    username = f.read().strip()
                # Get current credits
                with open(os.path.join(os.path.dirname(__file__), "userData.txt"), "r") as f:
                    allUserData = f.read()
                userDataList = allUserData.split("-")
                currentCredits = 0
                for entry in userDataList:
                    if username in entry:
                        entryParts = entry.split(":")
                        currentCredits = float(entryParts[2])
                        break
                totalCredits = currentCredits + creditsGained
                import main as M
                M.updateCredits(username, totalCredits)
                time.sleep(2)
                return True
        elif int(options) == 2:
            print("The loan shark is asleep")
            return True
        
        elif int(options) == 3:
            print("You cannot truly escape.")
            print("You shall log on to Gambling.com very very soon.")
            print("Goodbye")
            print("For now...............")
            time.sleep(2)
            return True